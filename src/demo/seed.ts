// Datos de ejemplo del mockup: 15 habitaciones, ~3 meses de reservas y limpiezas.
// Generados con una semilla fija para que el mockup sea siempre igual (relativo a hoy).
import { addDays, format } from "date-fns";

type Row = Record<string, any>;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEMO_USERS = {
  manager: "u-pilar",
  cleaner: "u-ana",
};

export function buildSeed() {
  const rnd = mulberry32(20261003);
  const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const now = new Date();
  const day = (n: number) => format(addDays(now, n), "yyyy-MM-dd");
  const at = (n: number, h: number, m: number) => {
    const d = addDays(now, n);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };
  let seq = 0;
  const id = (p: string) => `${p}-${++seq}`;

  const profiles: Row[] = [
    { id: "u-pilar", full_name: "Mª Pilar Fernández", role: "manager", phone: "600 111 222", active: true },
    { id: "u-jorge", full_name: "Jorge Sanz", role: "manager", phone: "600 333 444", active: true },
    { id: "u-ana", full_name: "Ana Pérez", role: "cleaner", phone: "611 222 333", active: true },
    { id: "u-lucia", full_name: "Lucía Gómez", role: "cleaner", phone: "622 333 444", active: true },
    { id: "u-marta", full_name: "Marta Ruiz", role: "cleaner", phone: "633 444 555", active: true },
  ];
  const cleaners = ["u-ana", "u-lucia", "u-marta"];

  const types = [
    ["Doble", 2, 85], ["Doble", 2, 85], ["Twin", 2, 80], ["Individual", 1, 65], ["Suite", 4, 160],
  ] as const;
  const rooms: Row[] = Array.from({ length: 15 }, (_, i) => {
    const floor = 1 + Math.floor(i / 5);
    const [room_type, capacity] = types[i % 5];
    return {
      id: `room-${i}`, number: `${floor}0${(i % 5) + 1}`, name: null, room_type, floor, capacity,
      status: "clean", ical_token: "demo" + i, base_price: types[i % 5][2], notes: null, active: true, updated_at: now.toISOString(),
    };
  });
  const price = (i: number) => types[i % 5][2];

  const sources: Row[] = [
    { id: "src-booking", name: "Booking.com", color: "#003580", auto_confirm: false },
    { id: "src-airbnb", name: "Airbnb", color: "#ff5a5f", auto_confirm: false },
    { id: "src-expedia", name: "Expedia", color: "#d39b00", auto_confirm: false },
    { id: "src-direct", name: "Directo", color: "#10b981", auto_confirm: true },
    { id: "src-web", name: "Web del hotel", color: "#7c3aed", auto_confirm: false },
  ];
  const sourceFor = () => {
    const r = rnd();
    return r < 0.45 ? "src-booking" : r < 0.75 ? "src-airbnb" : r < 0.87 ? "src-expedia" : "src-direct";
  };

  const first = ["María", "Carlos", "Sophie", "John", "Lucas", "Emma", "Pablo", "Giulia", "Hans", "Elena", "Marco", "Chloé", "David", "Sara", "Tom", "Inés", "Pierre", "Anna", "Javier", "Olivia"];
  const last = ["García", "Smith", "Dubois", "Rossi", "Müller", "López", "Johnson", "Martínez", "Bernard", "Fernández", "Schmidt", "Moreno", "Brown", "Navarro", "Weber"];
  const guest = () => `${pick(first)} ${pick(last)}`;

  const reservations: Row[] = [];
  const addRes = (roomIdx: number | null, ci: number, co: number, status?: string, src?: string) => {
    const nightsN = co - ci;
    const r: Row = {
      id: id("res"), room_id: roomIdx === null ? null : rooms[roomIdx].id, source_id: src ?? sourceFor(),
      external_uid: null, guest_name: guest(), guest_email: null, guest_phone: null, guests: int(1, 2),
      check_in: day(ci), check_out: day(co),
      status: status ?? (co <= 0 ? "checked_out" : ci <= 0 ? "checked_in" : "confirmed"),
      total_amount: roomIdx === null ? null : nightsN * (price(roomIdx) + int(-10, 25)),
      notes: null, requested_room_type: null, reference: null,
      created_at: at(Math.min(ci, 0) - int(3, 40), 10, 0), updated_at: now.toISOString(),
    };
    reservations.push(r);
    return r;
  };

  rooms.forEach((_, i) => {
    if (i === 13) return; // 304: fuera de servicio, sin reservas
    // Habitaciones 0-5 tienen salida hoy; 6-10 tienen cliente alojado
    const departsToday = i <= 5;
    const inHouse = i >= 6 && i <= 10;
    // 302, 303 y 305 quedan libres las próximas semanas: así el formulario web muestra disponibilidad
    const freeSoon = i === 11 || i === 12 || i === 14;
    const futureStart = departsToday ? (i % 2 === 0 ? 0 : int(1, 3)) : inHouse ? -int(1, 3) : freeSoon ? int(14, 18) : int(0, 4);
    let cursor = departsToday ? 0 : Math.min(futureStart, -int(0, 2));
    while (cursor > -95) {
      const n = int(1, 6);
      addRes(i, cursor - n, cursor);
      cursor = cursor - n - int(0, 2);
    }
    cursor = futureStart;
    while (cursor < 45) {
      const n = int(1, 7);
      addRes(i, cursor, cursor + n);
      cursor += n + int(1, 4);
    }
  });
  // Reservas pendientes de aceptar (llegan de los canales)
  addRes(13, 6, 9, "pending", "src-booking");
  Object.assign(addRes(null, 3, 5, "pending", "src-web"), {
    guest_name: "Carmen Vidal", guest_email: "carmen.vidal@example.com", guest_phone: "655 010 203",
    requested_room_type: "Suite", reference: "WEB-7K3P9Q", total_amount: 320, notes: "Llegaremos sobre las 22:00",
  });
  addRes(null, 10, 14, "pending", "src-expedia");
  reservations.filter((r) => r.status === "confirmed" && r.check_in > day(7)).slice(0, 2).forEach((r) => (r.status = "pending"));
  reservations.filter((r) => r.status === "checked_out").slice(0, 3).forEach((r) => (r.status = "cancelled"));

  const checklistTemplates: Row[] = [
    { id: "tpl-out", name: "Limpieza de salida", order_type: "checkout_clean", created_at: at(-200, 9, 0), items: [
      "Ventilar la habitación", "Cambiar sábanas y fundas", "Cambiar toallas", "Limpiar y desinfectar baño",
      "Reponer amenities (gel, champú, papel)", "Quitar polvo de superficies", "Aspirar y fregar suelo",
      "Vaciar papeleras", "Revisar y reponer minibar", "Revisar objetos olvidados", "Comprobar luces, TV y aire acondicionado",
    ].map((label, k) => ({ key: `o${k}`, label })) },
    { id: "tpl-stay", name: "Repaso (cliente alojado)", order_type: "stayover", created_at: at(-200, 9, 1), items: [
      "Hacer la cama", "Cambiar toallas si están en el suelo", "Repasar baño", "Reponer amenities", "Vaciar papeleras",
    ].map((label, k) => ({ key: `s${k}`, label })) },
    { id: "tpl-deep", name: "Limpieza a fondo", order_type: "deep_clean", created_at: at(-200, 9, 2), items: [
      "Girar y aspirar colchón", "Lavar cortinas", "Limpiar cristales", "Limpiar interior de armarios", "Limpiar juntas del baño", "Limpiar rejillas de ventilación",
    ].map((label, k) => ({ key: `d${k}`, label })) },
    { id: "tpl-insp", name: "Revisión de responsable", order_type: "inspection", created_at: at(-200, 9, 3), items: [
      "Sin olores", "Cama perfecta", "Baño impecable", "Amenities completas",
    ].map((label, k) => ({ key: `i${k}`, label })) },
  ];
  const tpl = (t: string, done: boolean | ((k: number) => boolean)) =>
    checklistTemplates.find((x) => x.order_type === t)!.items.map((it: Row, k: number) => ({ ...it, done: typeof done === "function" ? done(k) : done }));

  const observations = [
    "Todo correcto, habitación en buen estado.", "El cliente dejó un cargador en la mesilla, lo llevo a recepción.",
    "Faltaban 2 perchas en el armario.", "Mucha arena en el suelo, he tardado más.", "Minibar: consumidas 2 aguas y 1 cerveza.",
    "Mancha en la moqueta junto a la ventana.", "Han fumado en el balcón, he dejado ventilando.",
  ];
  const issues = [
    "El grifo del lavabo gotea.", "La bombilla de la lámpara de pie está fundida.", "La cisterna no deja de correr agua.",
    "Mando de la TV sin pilas / no funciona.", "Toalla manchada de maquillaje, no sale.", "La persiana se atasca a media altura.",
    "El aire acondicionado hace mucho ruido.",
  ];

  const workOrders: Row[] = [];
  const notes: Row[] = [];
  const addNote = (wo: Row, body: string, is_issue: boolean, when: string, author = wo.assigned_to) =>
    notes.push({ id: id("note"), work_order_id: wo.id, author_id: author, body, is_issue, photo_path: null, created_at: when });

  // Histórico: una limpieza por cada salida de los últimos 90 días
  for (const r of reservations) {
    if (r.room_id === null || r.status !== "checked_out" || r.check_out >= day(0)) continue;
    const offset = Math.round((new Date(r.check_out).getTime() - new Date(day(0)).getTime()) / 864e5);
    const h = int(10, 13), m = int(0, 59), dur = int(18, 48);
    const startIso = at(offset, h, m);
    const wo: Row = {
      id: id("wo"), room_id: r.room_id, assigned_to: pick(cleaners), created_by: "u-pilar", reservation_id: r.id,
      order_type: "checkout_clean", priority: "normal", scheduled_date: r.check_out, status: rnd() < 0.7 ? "verified" : "done",
      instructions: null, checklist: tpl("checkout_clean", true), rating: int(2, 5),
      started_at: startIso, completed_at: new Date(new Date(startIso).getTime() + dur * 60000).toISOString(),
      verified_at: null, verified_by: null, created_at: at(offset, 8, 0), updated_at: startIso,
    };
    workOrders.push(wo);
    const roll = rnd();
    if (roll < 0.12) addNote(wo, pick(issues), true, wo.completed_at);
    else if (roll < 0.4) addNote(wo, pick(observations), false, wo.completed_at);
  }

  // Hoy: salidas → limpiezas de salida; alojados → repasos
  const todays = reservations.filter((r) => r.room_id && r.check_out === day(0) && r.status !== "cancelled");
  const plan = [
    { who: "u-ana", status: "done", progress: 1 },
    { who: "u-ana", status: "in_progress", progress: 0.45 },
    { who: "u-ana", status: "pending", progress: 0 },
    { who: "u-lucia", status: "in_progress", progress: 0.8 },
    { who: "u-lucia", status: "pending", progress: 0 },
    { who: "u-marta", status: "pending", progress: 0 },
  ];
  todays.forEach((r, k) => {
    const p = plan[k % plan.length];
    const arrivalSameDay = reservations.some((x) => x.room_id === r.room_id && x.check_in === day(0));
    const n = tpl("checkout_clean", false).length;
    const wo: Row = {
      id: id("wo"), room_id: r.room_id, assigned_to: p.who, created_by: "u-pilar", reservation_id: r.id,
      order_type: "checkout_clean", priority: arrivalSameDay ? "high" : "normal", scheduled_date: day(0), status: p.status,
      instructions: arrivalSameDay ? "Entrada hoy a las 15:00: prioridad." : null,
      checklist: tpl("checkout_clean", (i: number) => i < Math.round(p.progress * n)), rating: p.status === "pending" ? null : int(3, 5),
      started_at: p.status === "pending" ? null : at(0, 9, 10 + k * 7), completed_at: p.status === "done" ? at(0, 9, 48) : null,
      verified_at: null, verified_by: null, created_at: at(0, 8, 0), updated_at: at(0, 9, 0),
    };
    workOrders.push(wo);
    if (k === 0) addNote(wo, "Habitación terminada. Se han dejado unas gafas de sol, están en recepción.", false, at(0, 9, 49));
    if (k === 3) addNote(wo, "El grifo de la ducha gotea bastante, habría que avisar a mantenimiento.", true, at(0, 9, 31));
    if (k === 1) addNote(wo, "Falta papel higiénico en el carro, voy al almacén.", false, at(0, 9, 25));
  });
  reservations
    .filter((r) => r.status === "checked_in" && r.check_out > day(0))
    .slice(0, 3)
    .forEach((r, k) => {
      workOrders.push({
        id: id("wo"), room_id: r.room_id, assigned_to: cleaners[(k + 1) % 3], created_by: "u-pilar", reservation_id: r.id,
        order_type: "stayover", priority: "low", scheduled_date: day(0), status: "pending", instructions: k === 0 ? "No molestar antes de las 11:00" : null,
        checklist: tpl("stayover", false), rating: null, started_at: null, completed_at: null, verified_at: null, verified_by: null,
        created_at: at(0, 8, 0), updated_at: at(0, 8, 0),
      });
    });
  // Mañana: una limpieza a fondo para Ana
  workOrders.push({
    id: id("wo"), room_id: "room-4", assigned_to: "u-ana", created_by: "u-pilar", reservation_id: null,
    order_type: "deep_clean", priority: "normal", scheduled_date: day(1), status: "pending", instructions: "Limpieza trimestral de la suite.",
    checklist: tpl("deep_clean", false), rating: null, started_at: null, completed_at: null, verified_at: null, verified_by: null,
    created_at: at(0, 8, 0), updated_at: at(0, 8, 0),
  });

  // Estado de housekeeping de cada habitación
  for (const room of rooms) {
    const wo = workOrders.find((w) => w.room_id === room.id && w.scheduled_date === day(0) && w.order_type === "checkout_clean");
    room.status = wo ? ({ pending: "dirty", in_progress: "cleaning", done: "clean", verified: "inspected", issue: "dirty" } as Row)[wo.status] : rnd() < 0.5 ? "inspected" : "clean";
  }
  rooms[13].status = "out_of_service";
  rooms[13].notes = "Aire acondicionado averiado. Técnico citado.";

  const icalFeeds: Row[] = rooms.slice(0, 15).flatMap((r, i) => [
    { id: id("feed"), room_id: r.id, source_id: "src-booking", url: `https://admin.booking.com/hotel/hoteladmin/ical.html?t=demo-${i}`, active: true, last_synced_at: at(0, 8, 45), last_error: null },
    ...(i % 3 === 0 ? [{ id: id("feed"), room_id: r.id, source_id: "src-airbnb", url: `https://www.airbnb.es/calendar/ical/${7000 + i}.ics?s=demo`, active: true, last_synced_at: at(0, 8, 45), last_error: null }] : []),
  ]);

  return {
    profiles, rooms, booking_sources: sources, reservations, work_orders: workOrders, work_order_notes: notes,
    checklist_templates: checklistTemplates, ical_feeds: icalFeeds,
  } as Record<string, Row[]>;
}
