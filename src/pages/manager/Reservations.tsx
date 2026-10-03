import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { availableRooms } from "../../lib/api";
import { useHotel } from "../../lib/outlet";
import { useRealtime } from "../../lib/useRealtime";
import { errorMessage, eur, fmtDate, nights, toISODate } from "../../lib/format";
import { reservationStatusLabel } from "../../lib/labels";
import type { Reservation, ReservationStatus, Room } from "../../lib/types";
import { Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Textarea, cx } from "../../components/ui";
import { ReservationStatusBadge } from "../../components/StatusBadges";
import { useToast } from "../../components/Toaster";
import ReservationDetail from "../../components/ReservationDetail";
import { useAuth } from "../../auth/AuthProvider";

const tabs: { key: "pending" | "upcoming" | "all"; label: string }[] = [
  { key: "pending", label: "Pendientes de aceptar" },
  { key: "upcoming", label: "Próximas" },
  { key: "all", label: "Todas" },
];

export default function Reservations() {
  const lookups = useHotel();
  const { roomById, sourceById } = lookups;
  const [tab, setTab] = useState<(typeof tabs)[number]["key"]>("pending");
  const [items, setItems] = useState<Reservation[] | null>(null);
  const [selected, setSelected] = useState<Reservation | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    let q = supabase.from("reservations").select("*");
    const today = toISODate(new Date());
    if (tab === "pending") q = q.eq("status", "pending").order("check_in");
    else if (tab === "upcoming") q = q.gte("check_out", today).in("status", ["confirmed", "checked_in"]).order("check_in");
    else q = q.order("check_in", { ascending: false }).limit(300);
    const { data } = await q;
    setItems((data ?? []) as Reservation[]);
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);
  useRealtime(["reservations"], () => load());

  const filtered = (items ?? []).filter((r) => !search || r.guest_name.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <PageHeader
        title="Reservas"
        subtitle="Acepta o rechaza las reservas entrantes viendo la disponibilidad y el estado de cada habitación"
        actions={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nueva reserva</Button>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cx("rounded-lg px-3 py-1.5 text-sm font-medium", tab === t.key ? "bg-brand-700 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200")}
          >
            {t.label}
          </button>
        ))}
        <Input placeholder="Buscar huésped…" value={search} onChange={(e) => setSearch(e.target.value)} className="ml-auto max-w-xs" />
      </div>

      {!items ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <EmptyState>{tab === "pending" ? "No hay reservas pendientes de aceptar. 🎉" : "No hay reservas."}</EmptyState>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Huésped</th>
                <th className="px-4 py-2.5 font-medium">Canal</th>
                <th className="px-4 py-2.5 font-medium">Fechas</th>
                <th className="px-4 py-2.5 font-medium">Hab.</th>
                <th className="px-4 py-2.5 font-medium">Importe</th>
                <th className="px-4 py-2.5 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((r) => {
                const src = r.source_id ? sourceById.get(r.source_id) : undefined;
                return (
                  <tr key={r.id} onClick={() => setSelected(r)} className="cursor-pointer hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{r.guest_name}<div className="text-xs font-normal text-slate-500">{r.guests} pers.</div></td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: src?.color ?? "#94a3b8" }} />
                        {src?.name ?? "Directo"}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {fmtDate(r.check_in, "d MMM")} → {fmtDate(r.check_out, "d MMM yy")}
                      <div className="text-xs text-slate-500">{nights(r.check_in, r.check_out)} noches</div>
                    </td>
                    <td className="px-4 py-3">{r.room_id ? roomById.get(r.room_id)?.number : <span className="text-amber-700">Sin asignar</span>}</td>
                    <td className="px-4 py-3">{r.total_amount != null ? eur(r.total_amount) : "—"}</td>
                    <td className="px-4 py-3"><ReservationStatusBadge status={r.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <ReservationDetail reservation={selected} onClose={() => setSelected(null)} onChanged={load} lookups={lookups} />
      {creating && <NewReservation onClose={() => setCreating(false)} onCreated={load} />}
    </>
  );
}

function NewReservation({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { sources } = useHotel();
  const { profile } = useAuth();
  const toast = useToast();
  const today = toISODate(new Date());
  const [form, setForm] = useState({
    guest_name: "", guest_email: "", guest_phone: "", guests: 2,
    check_in: today, check_out: toISODate(new Date(Date.now() + 86400000)),
    room_id: "", source_id: sources.find((s) => s.name === "Directo")?.id ?? "",
    total_amount: "", notes: "", status: "confirmed" as ReservationStatus,
  });
  const [free, setFree] = useState<Room[]>([]);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form, v: string | number) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (form.check_out > form.check_in) availableRooms(form.check_in, form.check_out).then(setFree).catch(() => setFree([]));
  }, [form.check_in, form.check_out]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.from("reservations").insert({
      ...form,
      room_id: form.room_id || null,
      source_id: form.source_id || null,
      total_amount: form.total_amount ? Number(form.total_amount) : null,
      guest_email: form.guest_email || null,
      guest_phone: form.guest_phone || null,
      created_by: profile?.id,
    });
    setSaving(false);
    if (error) {
      toast({ title: "No se pudo crear", body: error.code === "23P01" ? "La habitación ya está ocupada en esas fechas" : errorMessage(error), tone: "error" });
      return;
    }
    toast({ title: "Reserva creada", tone: "success" });
    onCreated();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Nueva reserva" wide>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre del huésped"><Input required value={form.guest_name} onChange={(e) => set("guest_name", e.target.value)} /></Field>
        <Field label="Huéspedes"><Input type="number" min={1} max={8} value={form.guests} onChange={(e) => set("guests", Number(e.target.value))} /></Field>
        <Field label="Email"><Input type="email" value={form.guest_email} onChange={(e) => set("guest_email", e.target.value)} /></Field>
        <Field label="Teléfono"><Input value={form.guest_phone} onChange={(e) => set("guest_phone", e.target.value)} /></Field>
        <Field label="Entrada"><Input type="date" required value={form.check_in} onChange={(e) => set("check_in", e.target.value)} /></Field>
        <Field label="Salida"><Input type="date" required min={form.check_in} value={form.check_out} onChange={(e) => set("check_out", e.target.value)} /></Field>
        <Field label="Habitación" hint={`${free.length} libres en esas fechas`}>
          <Select value={form.room_id} onChange={(e) => set("room_id", e.target.value)} required={form.status === "confirmed"}>
            <option value="">— Sin asignar —</option>
            {free.map((r) => <option key={r.id} value={r.id}>{r.number} · {r.room_type} ({r.capacity}p)</option>)}
          </Select>
        </Field>
        <Field label="Canal">
          <Select value={form.source_id} onChange={(e) => set("source_id", e.target.value)}>
            <option value="">Directo</option>
            {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Importe total (€)"><Input type="number" step="0.01" value={form.total_amount} onChange={(e) => set("total_amount", e.target.value)} /></Field>
        <Field label="Estado">
          <Select value={form.status} onChange={(e) => set("status", e.target.value)}>
            {(["confirmed", "pending"] as ReservationStatus[]).map((s) => <option key={s} value={s}>{reservationStatusLabel[s]}</option>)}
          </Select>
        </Field>
        <div className="sm:col-span-2"><Field label="Notas"><Textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></Field></div>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={saving}>Guardar</Button>
        </div>
      </form>
    </Modal>
  );
}
