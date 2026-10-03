import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { addDays, format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronRight } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../auth/AuthProvider";
import { useHotel } from "../../lib/outlet";
import { useRealtime } from "../../lib/useRealtime";
import { capitalize, toISODate } from "../../lib/format";
import { orderTypeLabel, priorityLabel } from "../../lib/labels";
import type { WorkOrder } from "../../lib/types";
import { EmptyState, Spinner, cx } from "../../components/ui";
import { OrderStatusBadge } from "../../components/StatusBadges";
import { useToast } from "../../components/Toaster";

export default function MyDay() {
  const { profile } = useAuth();
  const { roomById } = useHotel();
  const toast = useToast();
  const [offset, setOffset] = useState(0);
  const [orders, setOrders] = useState<WorkOrder[] | null>(null);
  const date = toISODate(addDays(new Date(), offset));

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("work_orders")
      .select("*")
      .eq("assigned_to", profile!.id)
      .eq("scheduled_date", date)
      .order("created_at");
    setOrders((data ?? []) as WorkOrder[]);
  }, [date, profile]);

  useEffect(() => {
    load();
  }, [load]);

  // Nuevas órdenes o cambios del responsable llegan al momento
  useRealtime(
    ["work_orders"],
    (_t, payload) => {
      if (payload.eventType === "INSERT") {
        const o = payload.new as unknown as WorkOrder;
        toast({ title: "Nueva tarea asignada", body: `Hab. ${roomById.get(o.room_id)?.number ?? ""} · ${orderTypeLabel[o.order_type]}`, tone: "info" });
        if ("vibrate" in navigator) navigator.vibrate?.(200);
      }
      load();
    },
    `assigned_to=eq.${profile!.id}`,
  );

  const rank = { urgent: 0, high: 1, normal: 2, low: 3 };
  const statusRank = { in_progress: 0, issue: 1, pending: 2, done: 3, verified: 4 };
  const sorted = (orders ?? []).slice().sort((a, b) => statusRank[a.status] - statusRank[b.status] || rank[a.priority] - rank[b.priority]);
  const pending = (orders ?? []).filter((o) => o.status === "pending" || o.status === "in_progress").length;

  return (
    <>
      <div className="mb-4 flex gap-2">
        {[0, 1].map((o) => (
          <button
            key={o}
            onClick={() => setOffset(o)}
            className={cx("flex-1 rounded-xl py-2.5 text-sm font-semibold", offset === o ? "bg-brand-700 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200")}
          >
            {o === 0 ? "Hoy" : "Mañana"}
          </button>
        ))}
      </div>
      <p className="mb-3 text-sm text-slate-600">
        {capitalize(format(parseISO(date), "EEEE d 'de' MMMM", { locale: es }))} · <b>{pending}</b> pendientes
      </p>

      {!orders ? (
        <Spinner />
      ) : sorted.length === 0 ? (
        <EmptyState>No tienes tareas asignadas para este día.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {sorted.map((o) => {
            const room = roomById.get(o.room_id);
            const done = o.checklist.filter((c) => c.done).length;
            return (
              <li key={o.id}>
                <Link
                  to={`/orden/${o.id}`}
                  className={cx(
                    "flex items-center gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 active:bg-slate-50",
                    (o.status === "done" || o.status === "verified") && "opacity-60",
                    o.priority === "urgent" && o.status === "pending" && "ring-2 ring-rose-400",
                  )}
                >
                  <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-brand-50 text-brand-800">
                    <span className="text-lg leading-none font-bold">{room?.number}</span>
                    <span className="text-[10px]">{room?.room_type}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{orderTypeLabel[o.order_type]}</p>
                    <p className="text-xs text-slate-500">
                      Prioridad {priorityLabel[o.priority].toLowerCase()}
                      {o.checklist.length > 0 && ` · ${done}/${o.checklist.length} hecho`}
                    </p>
                    <div className="mt-1.5"><OrderStatusBadge status={o.status} /></div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-slate-400" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
