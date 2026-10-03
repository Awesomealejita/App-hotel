import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { addDays, format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { AlertTriangle, CheckCheck, ChevronLeft, ChevronRight, Plus, Wand2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useHotel } from "../../lib/outlet";
import { useRealtime } from "../../lib/useRealtime";
import { capitalize, errorMessage, fmtTime, toISODate } from "../../lib/format";
import { orderTypeLabel, priorityColor, priorityLabel } from "../../lib/labels";
import type { ChecklistTemplate, Priority, WorkOrder, WorkOrderNote, WorkOrderType } from "../../lib/types";
import { Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Textarea, cx } from "../../components/ui";
import { OrderStatusBadge } from "../../components/StatusBadges";
import { useToast } from "../../components/Toaster";
import OrderTimeline from "../../components/OrderTimeline";
import { useAuth } from "../../auth/AuthProvider";

type OrderWithNotes = WorkOrder & { work_order_notes: WorkOrderNote[] };

export default function WorkOrders() {
  const { roomById, staffById, cleaners } = useHotel();
  const toast = useToast();
  const [date, setDate] = useState(toISODate(new Date()));
  const [orders, setOrders] = useState<OrderWithNotes[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("work_orders")
      .select("*, work_order_notes(*)")
      .eq("scheduled_date", date)
      .order("created_at");
    const list = (data ?? []) as OrderWithNotes[];
    list.forEach((o) => o.work_order_notes.sort((a, b) => a.created_at.localeCompare(b.created_at)));
    setOrders(list);
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);
  useRealtime(["work_orders", "work_order_notes"], () => load());

  const generate = async () => {
    setGenerating(true);
    const { data, error } = await supabase.rpc("generate_checkout_orders", { p_date: date });
    setGenerating(false);
    if (error) toast({ title: "Error", body: error.message, tone: "error" });
    else toast({ title: `${data} órdenes creadas`, body: "A partir de las salidas del día. Asígnalas a una limpiadora.", tone: "success" });
    load();
  };

  const assign = async (id: string, assigned_to: string) => {
    const { error } = await supabase.from("work_orders").update({ assigned_to: assigned_to || null }).eq("id", id);
    if (error) toast({ title: "Error", body: error.message, tone: "error" });
  };

  const sorted = useMemo(
    () =>
      (orders ?? []).slice().sort((a, b) => {
        const rank = { issue: 0, in_progress: 1, pending: 2, done: 3, verified: 4 };
        return rank[a.status] - rank[b.status] || (roomById.get(a.room_id)?.number ?? "").localeCompare(roomById.get(b.room_id)?.number ?? "");
      }),
    [orders, roomById],
  );

  const done = (orders ?? []).filter((o) => o.status === "done" || o.status === "verified").length;
  const open = orders?.find((o) => o.id === openId) ?? null;

  return (
    <>
      <PageHeader
        title="Órdenes de trabajo"
        subtitle="Limpieza y mantenimiento · las limpiadoras las ven al momento en su móvil"
        actions={
          <>
            <Button variant="secondary" onClick={generate} loading={generating}><Wand2 className="h-4 w-4" /> Generar por salidas</Button>
            <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nueva orden</Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center rounded-lg bg-white ring-1 ring-slate-300">
          <button className="p-2" onClick={() => setDate(toISODate(addDays(parseISO(date), -1)))} aria-label="Día anterior"><ChevronLeft className="h-4 w-4" /></button>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40 ring-0" />
          <button className="p-2" onClick={() => setDate(toISODate(addDays(parseISO(date), 1)))} aria-label="Día siguiente"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <span className="text-sm text-slate-600">{capitalize(format(parseISO(date), "EEEE d 'de' MMMM", { locale: es }))}</span>
        {orders && orders.length > 0 && (
          <div className="ml-auto flex items-center gap-2 text-sm">
            <div className="h-2 w-40 rounded-full bg-slate-200">
              <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${(100 * done) / orders.length}%` }} />
            </div>
            <span className="font-medium">{done}/{orders.length} terminadas</span>
          </div>
        )}
      </div>

      {!orders ? (
        <Spinner />
      ) : sorted.length === 0 ? (
        <EmptyState>No hay órdenes para este día. Crea una o genera las de las salidas.</EmptyState>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sorted.map((o) => {
            const room = roomById.get(o.room_id);
            const checked = o.checklist.filter((c) => c.done).length;
            const issues = o.work_order_notes.filter((n) => n.is_issue).length;
            return (
              <Card key={o.id} className={cx("cursor-pointer transition hover:ring-brand-500", o.status === "issue" && "ring-rose-300")}>
                <div onClick={() => setOpenId(o.id)}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-lg font-bold">Hab. {room?.number}</p>
                      <p className="text-xs text-slate-500">{orderTypeLabel[o.order_type]} · <span className={priorityColor[o.priority]}>{priorityLabel[o.priority]}</span></p>
                    </div>
                    <OrderStatusBadge status={o.status} />
                  </div>
                  {o.checklist.length > 0 && (
                    <div className="mt-3">
                      <div className="h-1.5 rounded-full bg-slate-100">
                        <div className="h-1.5 rounded-full bg-brand-600" style={{ width: `${(100 * checked) / o.checklist.length}%` }} />
                      </div>
                      <p className="mt-1 text-xs text-slate-500">Checklist {checked}/{o.checklist.length}
                        {o.started_at && ` · inicio ${fmtTime(o.started_at)}`}
                        {o.completed_at && ` · fin ${fmtTime(o.completed_at)}`}
                      </p>
                    </div>
                  )}
                  {o.work_order_notes.length > 0 && (
                    <p className="mt-2 line-clamp-2 text-sm text-slate-600">
                      {issues > 0 && <AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-rose-600" />}
                      “{o.work_order_notes[o.work_order_notes.length - 1].body}”
                    </p>
                  )}
                </div>
                <Select
                  value={o.assigned_to ?? ""}
                  onChange={(e) => assign(o.id, e.target.value)}
                  className="mt-3 py-1.5 text-xs"
                  aria-label="Asignar a"
                >
                  <option value="">— Sin asignar —</option>
                  {cleaners.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                </Select>
              </Card>
            );
          })}
        </div>
      )}

      {creating && <NewOrder date={date} onClose={() => setCreating(false)} onCreated={load} />}
      {open && (
        <Modal open onClose={() => setOpenId(null)} title={`Hab. ${roomById.get(open.room_id)?.number} · ${orderTypeLabel[open.order_type]}`} wide>
          <OrderManagerView order={open} staffById={staffById} onChanged={load} />
        </Modal>
      )}
    </>
  );
}

function OrderManagerView({ order, staffById, onChanged }: { order: OrderWithNotes; staffById: Map<string, import("../../lib/types").Profile>; onChanged: () => void }) {
  const toast = useToast();
  const { profile } = useAuth();
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const update = async (patch: Partial<WorkOrder>) => {
    setBusy(true);
    const { error } = await supabase.from("work_orders").update(patch).eq("id", order.id);
    setBusy(false);
    if (error) toast({ title: "Error", body: error.message, tone: "error" });
    else onChanged();
  };

  const sendReply = async () => {
    if (!reply.trim()) return;
    const { error } = await supabase.from("work_order_notes").insert({ work_order_id: order.id, author_id: profile?.id, body: reply.trim() });
    if (error) toast({ title: "Error", body: errorMessage(error), tone: "error" });
    else {
      setReply("");
      onChanged();
    }
  };

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <div className="mb-3 flex items-center gap-2">
          <OrderStatusBadge status={order.status} />
          <span className="text-sm text-slate-600">{order.assigned_to ? staffById.get(order.assigned_to)?.full_name : "Sin asignar"}</span>
        </div>
        {order.instructions && <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">📌 {order.instructions}</p>}
        <h3 className="mb-2 text-sm font-semibold">Checklist</h3>
        <ul className="space-y-1.5">
          {order.checklist.map((c) => (
            <li key={c.key} className={cx("flex items-center gap-2 text-sm", c.done ? "text-slate-700" : "text-slate-400")}>
              <span className={cx("flex h-4 w-4 items-center justify-center rounded text-[10px] text-white", c.done ? "bg-emerald-500" : "bg-slate-200")}>{c.done && "✓"}</span>
              {c.label}
            </li>
          ))}
        </ul>
        {order.rating && <p className="mt-3 text-sm text-slate-600">Estado al entrar: {"★".repeat(order.rating)}{"☆".repeat(5 - order.rating)}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {order.status === "done" && (
            <Button variant="success" onClick={() => update({ status: "verified" })} loading={busy}><CheckCheck className="h-4 w-4" /> Verificar</Button>
          )}
          {(order.status === "done" || order.status === "verified" || order.status === "issue") && (
            <Button variant="secondary" onClick={() => update({ status: "in_progress", completed_at: null })} loading={busy}>Reabrir</Button>
          )}
        </div>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">Observaciones</h3>
        <OrderTimeline notes={order.work_order_notes} staffById={staffById} />
        <div className="mt-3 flex gap-2">
          <Input placeholder="Responder a la limpiadora…" value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendReply()} />
          <Button onClick={sendReply}>Enviar</Button>
        </div>
      </div>
    </div>
  );
}

function NewOrder({ date, onClose, onCreated }: { date: string; onClose: () => void; onCreated: () => void }) {
  const { rooms, cleaners } = useHotel();
  const { profile } = useAuth();
  const toast = useToast();
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [roomIds, setRoomIds] = useState<string[]>([]);
  const [form, setForm] = useState({
    assigned_to: "", order_type: "checkout_clean" as WorkOrderType, priority: "normal" as Priority,
    scheduled_date: date, instructions: "", template_id: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("checklist_templates").select("*").order("created_at").then(({ data }) => setTemplates((data ?? []) as ChecklistTemplate[]));
  }, []);

  // Al cambiar el tipo, preselecciona su plantilla
  useEffect(() => {
    const t = templates.find((x) => x.order_type === form.order_type);
    setForm((f) => ({ ...f, template_id: t?.id ?? "" }));
  }, [form.order_type, templates]);

  const toggleRoom = (id: string) => setRoomIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (roomIds.length === 0) {
      toast({ title: "Elige al menos una habitación", tone: "warning" });
      return;
    }
    setSaving(true);
    const tpl = templates.find((t) => t.id === form.template_id);
    const checklist = (tpl?.items ?? []).map((i) => ({ ...i, done: false }));
    const { error } = await supabase.from("work_orders").insert(
      roomIds.map((room_id) => ({
        room_id,
        assigned_to: form.assigned_to || null,
        order_type: form.order_type,
        priority: form.priority,
        scheduled_date: form.scheduled_date,
        instructions: form.instructions || null,
        checklist,
        created_by: profile?.id,
      })),
    );
    setSaving(false);
    if (error) {
      toast({ title: "Error", body: error.message, tone: "error" });
      return;
    }
    toast({ title: `${roomIds.length} orden(es) creada(s)`, tone: "success" });
    onCreated();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Nueva orden de trabajo" wide>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <span className="mb-1 block text-sm font-medium text-slate-700">Habitaciones</span>
          <div className="grid grid-cols-5 gap-2 sm:grid-cols-8">
            {rooms.filter((r) => r.active).map((r) => (
              <button
                type="button"
                key={r.id}
                onClick={() => toggleRoom(r.id)}
                className={cx("rounded-lg py-2 text-sm font-semibold ring-1", roomIds.includes(r.id) ? "bg-brand-700 text-white ring-brand-700" : "bg-white ring-slate-300")}
              >
                {r.number}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo">
            <Select value={form.order_type} onChange={(e) => setForm({ ...form, order_type: e.target.value as WorkOrderType })}>
              {(Object.keys(orderTypeLabel) as WorkOrderType[]).map((t) => <option key={t} value={t}>{orderTypeLabel[t]}</option>)}
            </Select>
          </Field>
          <Field label="Checklist">
            <Select value={form.template_id} onChange={(e) => setForm({ ...form, template_id: e.target.value })}>
              <option value="">Sin checklist</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.items.length})</option>)}
            </Select>
          </Field>
          <Field label="Asignar a">
            <Select value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}>
              <option value="">— Sin asignar —</option>
              {cleaners.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </Select>
          </Field>
          <Field label="Prioridad">
            <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}>
              {(Object.keys(priorityLabel) as Priority[]).map((p) => <option key={p} value={p}>{priorityLabel[p]}</option>)}
            </Select>
          </Field>
          <Field label="Fecha"><Input type="date" value={form.scheduled_date} onChange={(e) => setForm({ ...form, scheduled_date: e.target.value })} /></Field>
        </div>
        <Field label="Instrucciones"><Textarea rows={2} placeholder="Ej.: cliente VIP, preparar cuna…" value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={saving}>Crear {roomIds.length > 1 ? `${roomIds.length} órdenes` : "orden"}</Button>
        </div>
      </form>
    </Modal>
  );
}
