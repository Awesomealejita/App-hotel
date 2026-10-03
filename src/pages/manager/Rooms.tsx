import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, User } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useHotel } from "../../lib/outlet";
import { useRealtime } from "../../lib/useRealtime";
import { fmtDate, toISODate } from "../../lib/format";
import { roomStatusLabel } from "../../lib/labels";
import type { Reservation, RoomStatus, WorkOrder } from "../../lib/types";
import { Card, PageHeader, Select, cx } from "../../components/ui";
import { OrderStatusBadge } from "../../components/StatusBadges";
import { useToast } from "../../components/Toaster";

const statusBorder: Record<RoomStatus, string> = {
  clean: "border-t-emerald-500",
  inspected: "border-t-sky-500",
  cleaning: "border-t-amber-500",
  dirty: "border-t-rose-500",
  out_of_service: "border-t-slate-400",
};

export default function Rooms() {
  const { rooms, staffById } = useHotel();
  const toast = useToast();
  const [stays, setStays] = useState<Reservation[]>([]);
  const [orders, setOrders] = useState<(WorkOrder & { issues: number })[]>([]);
  const [filter, setFilter] = useState<RoomStatus | "all">("all");

  const load = useCallback(async () => {
    const today = toISODate(new Date());
    const [s, o] = await Promise.all([
      supabase.from("reservations").select("*").lte("check_in", today).gte("check_out", today).in("status", ["confirmed", "checked_in"]),
      supabase.from("work_orders").select("*, work_order_notes(is_issue)").eq("scheduled_date", today),
    ]);
    setStays((s.data ?? []) as Reservation[]);
    setOrders(
      ((o.data ?? []) as (WorkOrder & { work_order_notes: { is_issue: boolean }[] })[]).map((w) => ({
        ...w,
        issues: w.work_order_notes.filter((n) => n.is_issue).length,
      })),
    );
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useRealtime(["reservations", "work_orders", "work_order_notes"], () => load());

  const setStatus = async (id: string, status: RoomStatus) => {
    const { error } = await supabase.from("rooms").update({ status }).eq("id", id);
    if (error) toast({ title: "Error", body: error.message, tone: "error" });
  };

  const today = toISODate(new Date());
  const visible = rooms.filter((r) => r.active && (filter === "all" || r.status === filter));

  return (
    <>
      <PageHeader
        title="Habitaciones"
        subtitle="Estado de limpieza (housekeeping) en tiempo real"
        actions={
          <Select value={filter} onChange={(e) => setFilter(e.target.value as RoomStatus | "all")} className="w-48">
            <option value="all">Todas</option>
            {(Object.keys(roomStatusLabel) as RoomStatus[]).map((s) => <option key={s} value={s}>{roomStatusLabel[s]}</option>)}
          </Select>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {visible.map((room) => {
          const stay = stays.find((s) => s.room_id === room.id && s.check_out > today);
          const departing = stays.find((s) => s.room_id === room.id && s.check_out === today);
          const arriving = stays.find((s) => s.room_id === room.id && s.check_in === today);
          const roomOrders = orders.filter((o) => o.room_id === room.id);
          return (
            <Card key={room.id} className={cx("border-t-4", statusBorder[room.status])}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xl font-bold">{room.number}</p>
                  <p className="text-xs text-slate-500">{room.room_type} · {room.capacity}p · Planta {room.floor}</p>
                </div>
                <Select
                  value={room.status}
                  onChange={(e) => setStatus(room.id, e.target.value as RoomStatus)}
                  className="w-auto py-1 text-xs"
                  aria-label="Estado"
                >
                  {(Object.keys(roomStatusLabel) as RoomStatus[]).map((s) => <option key={s} value={s}>{roomStatusLabel[s]}</option>)}
                </Select>
              </div>
              <div className="mt-3 space-y-1 text-sm">
                {stay && <p className="flex items-center gap-1.5 text-slate-700"><User className="h-3.5 w-3.5" /> {stay.guest_name} · hasta {fmtDate(stay.check_out, "d MMM")}</p>}
                {departing && <p className="text-rose-700">↗ Salida hoy: {departing.guest_name}</p>}
                {arriving && <p className="text-emerald-700">↘ Llegada hoy: {arriving.guest_name}</p>}
                {!stay && !departing && !arriving && <p className="text-slate-400">Libre</p>}
              </div>
              {roomOrders.length > 0 && (
                <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
                  {roomOrders.map((o) => (
                    <div key={o.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate text-slate-600">
                        {o.assigned_to ? staffById.get(o.assigned_to)?.full_name : "Sin asignar"} ·{" "}
                        {o.checklist.filter((c) => c.done).length}/{o.checklist.length}
                      </span>
                      <span className="flex items-center gap-1">
                        {o.issues > 0 && <AlertTriangle className="h-3.5 w-3.5 text-rose-600" aria-label={`${o.issues} incidencias`} />}
                        <OrderStatusBadge status={o.status} />
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {room.notes && <p className="mt-2 text-xs text-slate-500">📝 {room.notes}</p>}
            </Card>
          );
        })}
      </div>
    </>
  );
}
