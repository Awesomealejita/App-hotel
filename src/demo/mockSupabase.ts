// Sustituto en memoria de supabase-js para el mockup autocontenido.
// Implementa solo la parte de la API que usa la app, más la lógica de negocio
// de la base de datos (triggers y RPC) para que el mockup se comporte como la real.
import { buildSeed, DEMO_USERS } from "./seed";

type Row = Record<string, any>;
type Filter = (r: Row) => boolean;
type Listener = { table: string; filter?: string; cb: (p: Row) => void };

const db = buildSeed();
let currentUser: string | null = DEMO_USERS.manager;
const authListeners = new Set<(e: string, s: Row | null) => void>();
const listeners = new Set<Listener>();
const photoUrls = new Map<string, string>();
let seq = 1000;
const newId = (p: string) => `${p}-${++seq}`;
const today = () => new Date().toISOString().slice(0, 10);
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

const session = () =>
  currentUser
    ? { access_token: "demo", token_type: "bearer", expires_at: 9999999999, user: { id: currentUser, email: `${currentUser}@demo.hotel` } }
    : null;
const isManager = () => db.profiles.find((p) => p.id === currentUser)?.role === "manager";
const err = (message: string, code?: string) => ({ message, code });

const actionListeners = new Set<(a: Row) => void>();

function emit(table: string, eventType: "INSERT" | "UPDATE" | "DELETE", row: Row, old: Row = {}) {
  // Para la prueba guiada: quién hizo qué
  const action = { table, eventType, row: clone(row), old: clone(old), user: currentUser };
  actionListeners.forEach((cb) => cb(action));
  // Diferido como en Realtime: llega después de la respuesta de la petición
  setTimeout(() => {
    for (const l of listeners) {
      if (l.table !== table) continue;
      if (l.filter) {
        const [col, rest] = l.filter.split("=");
        if (String(row[col]) !== rest.replace(/^eq\./, "")) continue;
      }
      l.cb({ eventType, new: clone(row), old: clone(old), table, schema: "public" });
    }
  }, 30);
}

// ------------------------------------------------------------------ "triggers"
const ACTIVE = ["confirmed", "checked_in"];
const overlaps = (a: Row, b: Row) => a.check_in < b.check_out && b.check_in < a.check_out;

function checkReservation(r: Row) {
  if (r.check_out <= r.check_in) return err("La salida debe ser posterior a la entrada", "23514");
  if (r.room_id && ACTIVE.includes(r.status)) {
    const clash = db.reservations.some((x) => x.id !== r.id && x.room_id === r.room_id && ACTIVE.includes(x.status) && overlaps(x, r));
    if (clash) return err('conflicting key value violates exclusion constraint "reservations_no_overlap"', "23P01");
  }
  return null;
}

function setRoomStatus(roomId: string, status: string) {
  const room = db.rooms.find((r) => r.id === roomId);
  if (!room || room.status === "out_of_service" || room.status === status) return;
  const old = { ...room };
  room.status = status;
  room.updated_at = new Date().toISOString();
  emit("rooms", "UPDATE", room, old);
}

function beforeWorkOrder(n: Row, o: Row | null) {
  if (o && !isManager()) {
    for (const k of ["room_id", "assigned_to", "order_type", "scheduled_date", "priority", "instructions"]) {
      if (n[k] !== o[k]) return err("Solo un responsable puede modificar esos campos");
    }
    if (n.status === "verified") return err("Solo un responsable puede verificar");
  }
  if (!o || n.status !== o.status) {
    if (n.status === "in_progress" && !n.started_at) n.started_at = new Date().toISOString();
    if (n.status === "done") n.completed_at = n.completed_at ?? new Date().toISOString();
    if (n.status === "verified") {
      n.verified_at = new Date().toISOString();
      n.verified_by = currentUser;
    }
  }
  return null;
}

function afterWorkOrder(n: Row) {
  if (["checkout_clean", "stayover", "deep_clean"].includes(n.order_type)) {
    const map: Row = { in_progress: "cleaning", done: "clean", verified: "inspected" };
    if (map[n.status]) setRoomStatus(n.room_id, map[n.status]);
  }
}

function afterReservation(n: Row, o: Row | null) {
  if (n.status === "checked_out" && o?.status !== "checked_out" && n.room_id) setRoomStatus(n.room_id, "dirty");
}

// ------------------------------------------------------------------ embeds
function splitTop(s: string) {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const singular = (t: string) => t.replace(/s$/, "");

function project(row: Row, table: string, select: string): Row {
  const parts = splitTop(select || "*");
  let out: Row = {};
  for (const p of parts) {
    const m = p.match(/^(\w+)\((.*)\)$/);
    if (m) {
      const [, rel, inner] = m;
      if (row[`${singular(rel)}_id`] !== undefined) {
        const target = db[rel]?.find((x) => x.id === row[`${singular(rel)}_id`]);
        out[rel] = target ? project(target, rel, inner) : null;
      } else {
        out[rel] = (db[rel] ?? []).filter((x) => x[`${singular(table)}_id`] === row.id).map((x) => project(x, rel, inner));
      }
    } else if (p === "*") out = { ...out, ...clone(row) };
    else out[p] = clone(row[p]);
  }
  return out;
}

// ------------------------------------------------------------------ query builder
class Query implements PromiseLike<any> {
  private filters: Filter[] = [];
  private orders: { col: string; asc: boolean; nullsFirst?: boolean }[] = [];
  private limitN?: number;
  private mode: "many" | "single" | "maybe" = "many";
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private payload: any;
  private selectStr = "*";
  private countOpt?: { count?: string; head?: boolean };
  private returning = false;

  constructor(private table: string) {}

  select(cols = "*", opts?: { count?: string; head?: boolean }) {
    this.selectStr = cols;
    this.countOpt = opts;
    if (this.op !== "select") this.returning = true;
    return this;
  }
  insert(rows: Row | Row[]) { this.op = "insert"; this.payload = rows; return this; }
  upsert(rows: Row | Row[]) { this.op = "upsert"; this.payload = rows; return this; }
  update(patch: Row) { this.op = "update"; this.payload = patch; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c: string, v: any) { this.filters.push((r) => r[c] === v); return this; }
  neq(c: string, v: any) { this.filters.push((r) => r[c] !== v); return this; }
  in(c: string, vs: any[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  gte(c: string, v: any) { this.filters.push((r) => r[c] !== null && r[c] >= v); return this; }
  gt(c: string, v: any) { this.filters.push((r) => r[c] !== null && r[c] > v); return this; }
  lte(c: string, v: any) { this.filters.push((r) => r[c] !== null && r[c] <= v); return this; }
  lt(c: string, v: any) { this.filters.push((r) => r[c] !== null && r[c] < v); return this; }
  order(col: string, o: { ascending?: boolean; nullsFirst?: boolean } = {}) {
    this.orders.push({ col, asc: o.ascending ?? true, nullsFirst: o.nullsFirst });
    return this;
  }
  limit(n: number) { this.limitN = n; return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }

  then<A = any, B = never>(ok?: ((v: any) => A | PromiseLike<A>) | null, ko?: ((e: any) => B | PromiseLike<B>) | null) {
    return new Promise((res) => setTimeout(() => res(this.run()), 40)).then(ok, ko);
  }

  private visible(r: Row) {
    if (isManager()) return true;
    // RLS de limpiadoras
    if (this.table === "reservations" || this.table === "ical_feeds") return false;
    if (this.table === "work_orders") return r.assigned_to === currentUser;
    if (this.table === "work_order_notes") return db.work_orders.some((w) => w.id === r.work_order_id && w.assigned_to === currentUser);
    return true;
  }

  private run(): Row {
    const table = (db[this.table] ??= []);
    const match = () => table.filter((r) => this.visible(r) && this.filters.every((f) => f(r)));

    if (this.op === "insert" || this.op === "upsert") {
      const rows = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((r: Row) => ({ ...r }));
      const created: Row[] = [];
      for (const r of rows) {
        if (this.op === "upsert" && this.table === "ical_feeds") {
          const prev = table.find((x) => x.room_id === r.room_id && x.source_id === r.source_id);
          if (prev) {
            Object.assign(prev, r);
            created.push(prev);
            continue;
          }
        }
        const row = { ...defaults(this.table), ...r, id: r.id ?? newId(this.table) };
        const e = this.table === "reservations" ? checkReservation(row) : this.table === "work_orders" ? beforeWorkOrder(row, null) : null;
        if (e) return { data: null, error: e };
        table.push(row);
        created.push(row);
        emit(this.table, "INSERT", row);
        if (this.table === "work_orders") afterWorkOrder(row);
      }
      return this.finish(created);
    }

    if (this.op === "update") {
      const rows = match();
      for (const r of rows) {
        const old = { ...r };
        const next = { ...r, ...this.payload, updated_at: new Date().toISOString() };
        const e = this.table === "reservations" ? checkReservation(next) : this.table === "work_orders" ? beforeWorkOrder(next, old) : null;
        if (e) return { data: null, error: e };
        Object.assign(r, next);
        emit(this.table, "UPDATE", r, old);
        if (this.table === "work_orders") afterWorkOrder(r);
        if (this.table === "reservations") afterReservation(r, old);
      }
      return this.finish(rows);
    }

    if (this.op === "delete") {
      const rows = match();
      db[this.table] = table.filter((r) => !rows.includes(r));
      rows.forEach((r) => emit(this.table, "DELETE", r, r));
      return { data: null, error: null };
    }

    let rows = match();
    for (const o of [...this.orders].reverse()) {
      rows = [...rows].sort((a, b) => {
        const x = a[o.col], y = b[o.col];
        if (x === y) return 0;
        if (x === null || x === undefined) return o.nullsFirst ? -1 : 1;
        if (y === null || y === undefined) return o.nullsFirst ? 1 : -1;
        return (x < y ? -1 : 1) * (o.asc ? 1 : -1);
      });
    }
    const count = rows.length;
    if (this.limitN !== undefined) rows = rows.slice(0, this.limitN);
    if (this.countOpt?.head) return { data: null, count, error: null };
    return { ...this.finish(rows), count };
  }

  private finish(rows: Row[]) {
    const data = rows.map((r) => project(r, this.table, this.selectStr));
    if (this.op !== "select" && !this.returning) return { data: null, error: null };
    if (this.mode === "single") return data.length === 1 ? { data: data[0], error: null } : { data: null, error: err("No rows", "PGRST116") };
    if (this.mode === "maybe") return { data: data[0] ?? null, error: null };
    return { data, error: null };
  }
}

function defaults(table: string): Row {
  const now = new Date().toISOString();
  switch (table) {
    case "reservations":
      return { status: "pending", guests: 2, guest_name: "Huésped", external_uid: null, notes: null, total_amount: null, requested_room_type: null, reference: null, created_at: now, updated_at: now };
    case "work_orders":
      return { status: "pending", priority: "normal", order_type: "checkout_clean", checklist: [], rating: null, started_at: null, completed_at: null, verified_at: null, instructions: null, scheduled_date: today(), created_at: now, updated_at: now };
    case "work_order_notes":
      return { is_issue: false, photo_path: null, created_at: now };
    case "rooms":
      return { status: "clean", active: true, base_price: 85, ical_token: Math.random().toString(16).slice(2), notes: null, name: null, updated_at: now };
    case "checklist_templates":
      return { created_at: now, items: [] };
    default:
      return {};
  }
}

// ------------------------------------------------------------------ RPC
function availableRooms(from: string, to: string, exclude?: string | null) {
  return db.rooms
    .filter((r) => r.active && r.status !== "out_of_service")
    .filter((r) => !db.reservations.some((x) => x.room_id === r.id && ACTIVE.includes(x.status) && x.id !== exclude && x.check_in < to && from < x.check_out))
    .sort((a, b) => a.number.localeCompare(b.number));
}

const daysBetween = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = new Date(from + "T00:00:00Z"); d.toISOString().slice(0, 10) < to; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
};
const avg = (xs: number[]) => (xs.length ? Math.round((10 * xs.reduce((a, b) => a + b, 0)) / xs.length) / 10 : null);
const minutes = (w: Row) => (new Date(w.completed_at).getTime() - new Date(w.started_at).getTime()) / 60000;

function dashboardStats(from: string, to: string) {
  const SOLD = ["confirmed", "checked_in", "checked_out"];
  const rooms = db.rooms.filter((r) => r.active).length;
  const days = daysBetween(from, to);
  const series = days.map((day) => ({ day, occupied: db.reservations.filter((r) => SOLD.includes(r.status) && r.check_in <= day && day < r.check_out).length }));
  const sold = series.reduce((a, s) => a + s.occupied, 0);
  const arrivals = db.reservations.filter((r) => SOLD.includes(r.status) && r.check_in >= from && r.check_in < to);
  const bySource = new Map<string | null, number>();
  arrivals.forEach((r) => bySource.set(r.source_id, (bySource.get(r.source_id) ?? 0) + 1));
  const wo = db.work_orders.filter((w) => w.scheduled_date >= from && w.scheduled_date < to);
  const timed = wo.filter((w) => w.started_at && w.completed_at);
  const woIds = new Set(wo.map((w) => w.id));
  const notes = db.work_order_notes.filter((n) => woIds.has(n.work_order_id));
  const byCleaner = db.profiles
    .filter((p) => wo.some((w) => w.assigned_to === p.id))
    .map((p) => {
      const mine = wo.filter((w) => w.assigned_to === p.id);
      return {
        name: p.full_name,
        done: mine.filter((w) => ["done", "verified"].includes(w.status)).length,
        total: mine.length,
        avg_minutes: avg(mine.filter((w) => w.started_at && w.completed_at).map(minutes)),
        notes: notes.filter((n) => n.author_id === p.id).length,
      };
    })
    .sort((a, b) => b.done - a.done);
  const issuesByRoom = new Map<string, number>();
  notes.filter((n) => n.is_issue).forEach((n) => {
    const w = db.work_orders.find((x) => x.id === n.work_order_id)!;
    const num = db.rooms.find((r) => r.id === w.room_id)!.number;
    issuesByRoom.set(num, (issuesByRoom.get(num) ?? 0) + 1);
  });
  return {
    total_rooms: rooms,
    room_nights_sold: sold,
    occupancy_pct: Math.round((1000 * sold) / Math.max(rooms * days.length, 1)) / 10,
    revenue: arrivals.reduce((a, r) => a + (r.total_amount ?? 0), 0),
    reservations_by_status: {},
    reservations_by_source: [...bySource.entries()].map(([sid, count]) => {
      const s = db.booking_sources.find((x) => x.id === sid);
      return { source: s?.name ?? "Directo", color: s?.color ?? "#0ea5e9", count };
    }),
    occupancy_series: series,
    orders_total: wo.length,
    orders_done: wo.filter((w) => ["done", "verified"].includes(w.status)).length,
    orders_issue: wo.filter((w) => w.status === "issue").length,
    avg_clean_minutes: avg(timed.map(minutes)),
    avg_room_rating: avg(wo.filter((w) => w.rating).map((w) => w.rating)),
    by_cleaner: byCleaner,
    issues_by_room: [...issuesByRoom.entries()].map(([room, issues]) => ({ room, issues })).sort((a, b) => b.issues - a.issues),
  };
}

function publicAvailability(from: string, to: string, guests: number) {
  if (!from || !to || to <= from) throw err("La fecha de salida debe ser posterior a la de entrada");
  if (from < today()) throw err("La fecha de entrada no puede ser anterior a hoy");
  if (daysBetween(from, to).length > 30) throw err("Para estancias de más de 30 noches contacta con el hotel");
  const groups = new Map<string, Row>();
  for (const r of availableRooms(from, to).filter((x) => x.capacity >= Math.max(guests, 1))) {
    const g = groups.get(r.room_type) ?? { room_type: r.room_type, capacity: 0, available: 0, price_per_night: Infinity };
    g.capacity = Math.max(g.capacity, r.capacity);
    g.available++;
    g.price_per_night = Math.min(g.price_per_night, r.base_price);
    groups.set(r.room_type, g);
  }
  return [...groups.values()].sort((a, b) => a.price_per_night - b.price_per_night);
}

function rpc(fn: string, a: Row): Row {
  try {
    return rpcInner(fn, a);
  } catch (e) {
    return { data: null, error: e };
  }
}

function rpcInner(fn: string, a: Row): Row {
  switch (fn) {
    case "public_availability":
      return { data: publicAvailability(a.p_from, a.p_to, a.p_guests), error: null };
    case "request_booking": {
      const ref = "WEB-" + Math.random().toString(36).slice(2, 8).toUpperCase();
      if (a.p_website) return { data: ref, error: null };
      if (!a.p_name || a.p_name.trim().length < 2) throw err("Indica tu nombre");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.p_email ?? "")) throw err("El email no es válido");
      const opt = publicAvailability(a.p_check_in, a.p_check_out, a.p_guests).find((o) => o.room_type === a.p_room_type);
      if (!opt) throw err("Ya no queda disponibilidad para ese tipo de habitación en esas fechas");
      const row: Row = {
        ...defaults("reservations"), id: newId("res"), room_id: null, source_id: "src-web", external_uid: ref, reference: ref,
        guest_name: a.p_name.trim(), guest_email: a.p_email.trim().toLowerCase(), guest_phone: a.p_phone || null, guests: a.p_guests,
        check_in: a.p_check_in, check_out: a.p_check_out, status: "pending", requested_room_type: a.p_room_type,
        total_amount: opt.price_per_night * daysBetween(a.p_check_in, a.p_check_out).length, notes: a.p_notes || null,
      };
      db.reservations.push(row);
      emit("reservations", "INSERT", row);
      return { data: ref, error: null };
    }
    case "available_rooms":
      return { data: clone(availableRooms(a.p_from, a.p_to, a.p_exclude_reservation)), error: null };
    case "dashboard_stats":
      return { data: dashboardStats(a.p_from, a.p_to), error: null };
    case "decide_reservation": {
      const r = db.reservations.find((x) => x.id === a.p_id);
      if (!r) return { data: null, error: err("Reserva no encontrada") };
      const old = { ...r };
      if (a.p_accept) {
        const roomId = a.p_room_id ?? r.room_id;
        if (!roomId) return { data: null, error: err("Asigna una habitación antes de aceptar") };
        if (!availableRooms(r.check_in, r.check_out, r.id).some((x) => x.id === roomId)) return { data: null, error: err("La habitación no está disponible en esas fechas") };
        Object.assign(r, { status: "confirmed", room_id: roomId });
      } else r.status = "rejected";
      Object.assign(r, { decided_by: currentUser, decided_at: new Date().toISOString() });
      emit("reservations", "UPDATE", r, old);
      return { data: clone(r), error: null };
    }
    case "generate_checkout_orders": {
      const date = a.p_date;
      const tpl = db.checklist_templates.find((t) => t.order_type === "checkout_clean");
      const due = db.reservations.filter(
        (r) => r.check_out === date && r.room_id && ["confirmed", "checked_in", "checked_out"].includes(r.status) && !db.work_orders.some((w) => w.reservation_id === r.id),
      );
      for (const r of due) {
        const row: Row = {
          ...defaults("work_orders"), id: newId("wo"), room_id: r.room_id, reservation_id: r.id, scheduled_date: date, created_by: currentUser, assigned_to: null,
          checklist: (tpl?.items ?? []).map((i: Row) => ({ ...i, done: false })),
          priority: db.reservations.some((n) => n.room_id === r.room_id && n.check_in === date && n.status === "confirmed") ? "high" : "normal",
        };
        db.work_orders.push(row);
        emit("work_orders", "INSERT", row);
      }
      return { data: due.length, error: null };
    }
  }
  return { data: null, error: err(`RPC ${fn} no disponible en la demo`) };
}

// ------------------------------------------------------------------ cliente
const later = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 60));

export const supabase = {
  from: (table: string) => new Query(table),
  rpc: (fn: string, args: Row = {}) => later(rpc(fn, args)),
  auth: {
    getSession: () => later({ data: { session: session() }, error: null }),
    onAuthStateChange(cb: (e: string, s: Row | null) => void) {
      authListeners.add(cb);
      return { data: { subscription: { unsubscribe: () => authListeners.delete(cb) } } };
    },
    async signInWithPassword({ email }: { email: string; password: string }) {
      const user = db.profiles.find((p) => email.toLowerCase().includes(p.full_name.split(" ")[0].toLowerCase()));
      currentUser = user?.id ?? DEMO_USERS.manager;
      authListeners.forEach((cb) => cb("SIGNED_IN", session()));
      return { data: { session: session() }, error: null };
    },
    async signOut() {
      currentUser = null;
      authListeners.forEach((cb) => cb("SIGNED_OUT", null));
      return { error: null };
    },
  },
  channel() {
    const mine: Listener[] = [];
    const ch = {
      on(_t: string, cfg: { table: string; filter?: string }, cb: (p: Row) => void) {
        mine.push({ table: cfg.table, filter: cfg.filter, cb });
        return ch;
      },
      subscribe() {
        mine.forEach((l) => listeners.add(l));
        return ch;
      },
      _remove() {
        mine.forEach((l) => listeners.delete(l));
      },
    };
    return ch;
  },
  removeChannel(ch: { _remove: () => void }) {
    ch._remove();
  },
  storage: {
    from: () => ({
      async upload(path: string, file: File) {
        photoUrls.set(path, URL.createObjectURL(file));
        return { data: { path }, error: null };
      },
      async createSignedUrl(path: string) {
        return { data: { signedUrl: photoUrls.get(path) ?? null }, error: null };
      },
    }),
  },
  functions: {
    async invoke(name: string, { body }: { body: Row }) {
      await later(null);
      if (name === "sync-ical") {
        const free = availableRooms(addDaysIso(8), addDaysIso(11));
        const room = free[0];
        const row: Row = {
          ...defaults("reservations"), id: newId("res"), room_id: room?.id ?? null, source_id: "src-booking", external_uid: "bk-" + seq,
          guest_name: "Reserva Booking.com", check_in: addDaysIso(8), check_out: addDaysIso(11), status: "pending", notes: "Importada por iCal",
        };
        db.reservations.push(row);
        emit("reservations", "INSERT", row);
        db.ical_feeds.forEach((f) => (f.last_synced_at = new Date().toISOString()));
        return { data: { ok: true, feeds: db.ical_feeds.map((f, i) => ({ source: f.source_id, created: i === 0 ? 1 : 0, updated: 0, cancelled: 0 })) }, error: null };
      }
      if (name === "invite-user") {
        const p = { id: newId("u"), full_name: body.full_name, role: body.role, phone: body.phone || null, active: true };
        db.profiles.push(p);
        return { data: { id: p.id }, error: null };
      }
      return { data: null, error: err("Función no disponible en la demo") };
    },
  },
  // Controles exclusivos del mockup
  __demo: {
    switchUser(userId: string) {
      currentUser = userId;
      authListeners.forEach((cb) => cb("SIGNED_IN", session()));
    },
    currentUser: () => currentUser,
    onAction(cb: (a: Row) => void) {
      actionListeners.add(cb);
      return () => actionListeners.delete(cb);
    },
  },
};

function addDaysIso(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// Actividad simulada de las limpiadoras para ver el tiempo real en acción
const simNotes = [
  "Habitación lista. El cliente dejó propina para limpieza.",
  "Faltan perchas en el armario, repuestas del almacén.",
  "Se ha encontrado un cargador de móvil, llevado a recepción.",
];
let simStep = 0;
setInterval(() => {
  if (!isManager()) return; // solo mientras se mira el panel de responsable
  const t = today();
  const active = db.work_orders.filter((w) => w.scheduled_date === t && w.assigned_to && w.assigned_to !== DEMO_USERS.cleaner);
  const inProgress = active.find((w) => w.status === "in_progress");
  const target = inProgress ?? active.find((w) => w.status === "pending");
  if (!target) return;
  const old = { ...target, checklist: clone(target.checklist) };
  if (target.status === "pending") {
    target.status = "in_progress";
    target.started_at = new Date().toISOString();
  } else {
    const next = target.checklist.find((c: Row) => !c.done);
    if (next) {
      next.done = true;
      if (simStep++ % 3 === 0) {
        const note = { id: newId("note"), work_order_id: target.id, author_id: target.assigned_to, body: simNotes[simStep % simNotes.length], is_issue: false, photo_path: null, created_at: new Date().toISOString() };
        db.work_order_notes.push(note);
        emit("work_order_notes", "INSERT", note);
      }
    } else {
      target.status = "done";
      target.completed_at = new Date().toISOString();
      target.rating = 4;
    }
  }
  target.updated_at = new Date().toISOString();
  emit("work_orders", "UPDATE", target, old);
  afterWorkOrder(target);
}, 9000);

export const isConfigured = true;
export const PHOTO_BUCKET = "work-order-photos";
