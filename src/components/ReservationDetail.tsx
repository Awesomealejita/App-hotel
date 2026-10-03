import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, MessageSquare, XCircle } from "lucide-react";
import { supabase } from "../lib/supabase";
import { availableRooms, decideReservation } from "../lib/api";
import { errorMessage, eur, fmtDate, fmtDateTime, nights } from "../lib/format";
import { orderStatusLabel, roomStatusLabel } from "../lib/labels";
import type { Lookups } from "../lib/useLookups";
import type { Reservation, ReservationStatus, Room, WorkOrder, WorkOrderNote } from "../lib/types";
import { Button, Field, Modal, Select, cx } from "./ui";
import { ReservationStatusBadge, RoomStatusBadge } from "./StatusBadges";
import { useToast } from "./Toaster";

interface Props {
  reservation: Reservation | null;
  onClose: () => void;
  onChanged: () => void;
  lookups: Lookups;
}

type Feedback = (WorkOrder & { work_order_notes: WorkOrderNote[] }) | null;

/**
 * Ficha de reserva con todo lo que el responsable necesita para aceptarla:
 * disponibilidad real, estado actual de la habitación y el último feedback de limpieza.
 */
export default function ReservationDetail({ reservation, onClose, onChanged, lookups }: Props) {
  const toast = useToast();
  const [free, setFree] = useState<Room[]>([]);
  const [roomId, setRoomId] = useState<string>("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!reservation) return;
    setRoomId(reservation.room_id ?? "");
    availableRooms(reservation.check_in, reservation.check_out, reservation.id)
      .then((rooms) => {
        setFree(rooms);
        // Solicitud sin habitación: propone la primera libre del tipo que pidió el huésped
        if (!reservation.room_id && reservation.status === "pending") {
          const match = rooms.find((x) => x.room_type === reservation.requested_room_type && x.capacity >= reservation.guests);
          if (match) setRoomId(match.id);
        }
      })
      .catch(() => setFree([]));
  }, [reservation]);

  useEffect(() => {
    if (!roomId) {
      setFeedback(null);
      return;
    }
    supabase
      .from("work_orders")
      .select("*, work_order_notes(*)")
      .eq("room_id", roomId)
      .in("status", ["done", "verified", "issue"])
      .order("completed_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setFeedback(data as Feedback));
  }, [roomId]);

  if (!reservation) return null;
  const r = reservation;
  const source = r.source_id ? lookups.sourceById.get(r.source_id) : undefined;
  const room = roomId ? lookups.roomById.get(roomId) : undefined;
  const roomIsFree = !roomId || free.some((f) => f.id === roomId);
  const issues = feedback?.work_order_notes.filter((n) => n.is_issue) ?? [];

  const decide = async (accept: boolean) => {
    setBusy(true);
    try {
      await decideReservation(r.id, accept, roomId || null);
      toast({ title: accept ? "Reserva aceptada" : "Reserva rechazada", tone: accept ? "success" : "info" });
      onChanged();
      onClose();
    } catch (e) {
      toast({ title: "No se pudo actualizar", body: errorMessage(e), tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status: ReservationStatus) => {
    setBusy(true);
    const { error } = await supabase.from("reservations").update({ status }).eq("id", r.id);
    setBusy(false);
    if (error) toast({ title: "Error", body: error.message, tone: "error" });
    else {
      onChanged();
      onClose();
    }
  };

  return (
    <Modal open onClose={onClose} title={r.guest_name} wide>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <ReservationStatusBadge status={r.status} />
            {source && (
              <span className="flex items-center gap-1.5 text-slate-600">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: source.color }} /> {source.name}
              </span>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-y-2">
            <dt className="text-slate-500">Entrada</dt><dd className="font-medium">{fmtDate(r.check_in)}</dd>
            <dt className="text-slate-500">Salida</dt><dd className="font-medium">{fmtDate(r.check_out)}</dd>
            <dt className="text-slate-500">Noches</dt><dd>{nights(r.check_in, r.check_out)}</dd>
            <dt className="text-slate-500">Huéspedes</dt><dd>{r.guests}</dd>
            {r.guest_phone && (<><dt className="text-slate-500">Teléfono</dt><dd>{r.guest_phone}</dd></>)}
            {r.guest_email && (<><dt className="text-slate-500">Email</dt><dd className="truncate">{r.guest_email}</dd></>)}
            {r.requested_room_type && (<><dt className="text-slate-500">Tipo pedido</dt><dd className="font-medium">{r.requested_room_type}</dd></>)}
            {r.reference && (<><dt className="text-slate-500">Referencia</dt><dd className="font-mono">{r.reference}</dd></>)}
            {r.total_amount != null && (<><dt className="text-slate-500">Importe</dt><dd>{eur(r.total_amount)}</dd></>)}
          </dl>
          {r.notes && <p className="rounded-lg bg-slate-50 p-3 whitespace-pre-wrap text-slate-600">{r.notes}</p>}

          {r.status === "pending" && (
            <Field label="Habitación" hint={`${free.length} habitaciones libres en esas fechas${r.requested_room_type ? ` · ★ = tipo que pidió el huésped` : ""}`}>
              <Select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                <option value="">— Elegir —</option>
                {lookups.rooms
                  .filter((x) => x.active)
                  .sort((a, b) => Number(b.room_type === r.requested_room_type) - Number(a.room_type === r.requested_room_type))
                  .map((x) => {
                  const ok = free.some((f) => f.id === x.id);
                  return (
                    <option key={x.id} value={x.id} disabled={!ok}>
                      {x.room_type === r.requested_room_type ? "★ " : ""}{x.number} · {x.room_type} ({x.capacity}p) {ok ? `· ${roomStatusLabel[x.status]}` : "· OCUPADA"}
                    </option>
                  );
                })}
              </Select>
            </Field>
          )}
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Estado de la habitación</h3>
          {!room ? (
            <p className="text-sm text-slate-500">Elige una habitación para ver su estado y el feedback de limpieza.</p>
          ) : (
            <div className="space-y-3 rounded-lg p-3 ring-1 ring-slate-200">
              <div className="flex items-center justify-between">
                <span className="font-semibold">Hab. {room.number}</span>
                <RoomStatusBadge status={room.status} />
              </div>
              {!roomIsFree && (
                <p className="flex items-center gap-2 rounded bg-rose-50 p-2 text-sm text-rose-700">
                  <AlertTriangle className="h-4 w-4" /> Ocupada en esas fechas
                </p>
              )}
              {feedback ? (
                <div className="text-sm">
                  <p className="text-slate-600">
                    Última limpieza: {orderStatusLabel[feedback.status]}
                    {feedback.completed_at && ` · ${fmtDateTime(feedback.completed_at)}`}
                    {feedback.assigned_to && ` · ${lookups.staffById.get(feedback.assigned_to)?.full_name ?? ""}`}
                  </p>
                  {feedback.rating && <p className="text-slate-600">Estado en que la encontró: {"★".repeat(feedback.rating)}{"☆".repeat(5 - feedback.rating)}</p>}
                  <p className="text-slate-600">
                    Checklist: {feedback.checklist.filter((c) => c.done).length}/{feedback.checklist.length}
                  </p>
                  {feedback.work_order_notes.length > 0 && (
                    <ul className="mt-2 space-y-1.5">
                      {feedback.work_order_notes.map((n) => (
                        <li key={n.id} className={cx("flex gap-2 rounded p-2", n.is_issue ? "bg-rose-50 text-rose-800" : "bg-slate-50")}>
                          {n.is_issue ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />}
                          {n.body}
                        </li>
                      ))}
                    </ul>
                  )}
                  {issues.length > 0 && (
                    <p className="mt-2 text-xs font-medium text-rose-700">⚠️ Hay {issues.length} incidencia(s) reportadas: revísalas antes de aceptar.</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-500">Sin limpiezas registradas todavía.</p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
        {r.status === "pending" && (
          <>
            <Button variant="secondary" onClick={() => decide(false)} loading={busy}>
              <XCircle className="h-4 w-4" /> Rechazar
            </Button>
            <Button variant="success" onClick={() => decide(true)} loading={busy} disabled={!roomId || !roomIsFree}>
              <CheckCircle2 className="h-4 w-4" /> Aceptar reserva
            </Button>
          </>
        )}
        {r.status === "confirmed" && (
          <>
            <Button variant="secondary" onClick={() => setStatus("cancelled")} loading={busy}>Cancelar reserva</Button>
            <Button onClick={() => setStatus("checked_in")} loading={busy}>Hacer check-in</Button>
          </>
        )}
        {r.status === "checked_in" && (
          <Button onClick={() => setStatus("checked_out")} loading={busy}>Hacer check-out (marca la hab. como sucia)</Button>
        )}
      </div>
    </Modal>
  );
}
