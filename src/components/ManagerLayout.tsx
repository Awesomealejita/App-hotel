import logo from "../assets/icon.svg";
import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { BedDouble, CalendarRange, ClipboardList, LayoutDashboard, LogOut, Settings, Ticket } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { useLookups } from "../lib/useLookups";
import { useRealtime } from "../lib/useRealtime";
import { supabase } from "../lib/supabase";
import { orderStatusLabel } from "../lib/labels";
import type { Reservation, WorkOrder, WorkOrderNote } from "../lib/types";
import { useToast } from "./Toaster";
import { cx } from "./ui";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/calendario", label: "Calendario", icon: CalendarRange },
  { to: "/reservas", label: "Reservas", icon: Ticket },
  { to: "/habitaciones", label: "Habitaciones", icon: BedDouble },
  { to: "/ordenes", label: "Órdenes", icon: ClipboardList },
  { to: "/ajustes", label: "Ajustes", icon: Settings },
];

export default function ManagerLayout() {
  const { profile, signOut } = useAuth();
  const lookups = useLookups();
  const toast = useToast();
  const [pending, setPending] = useState(0);

  const loadPending = useCallback(async () => {
    const { count } = await supabase.from("reservations").select("id", { count: "exact", head: true }).eq("status", "pending");
    setPending(count ?? 0);
  }, []);
  useEffect(() => {
    loadPending();
  }, [loadPending]);

  // Notificaciones en tiempo real de lo que hacen las limpiadoras y de los canales
  useRealtime(["work_orders", "work_order_notes", "reservations"], (table, payload) => {
    if (table === "reservations") loadPending();
    if (table === "work_orders" && payload.eventType === "UPDATE") {
      const n = payload.new as unknown as WorkOrder;
      const o = payload.old as Partial<WorkOrder>;
      if (o.status && o.status === n.status) return;
      const room = lookups.roomById.get(n.room_id)?.number ?? "?";
      const who = n.assigned_to ? lookups.staffById.get(n.assigned_to)?.full_name ?? "" : "";
      toast({
        title: `Hab. ${room}: ${orderStatusLabel[n.status]}`,
        body: who ? `${who} actualizó la orden` : undefined,
        tone: n.status === "issue" ? "error" : n.status === "done" ? "success" : "info",
      });
    }
    if (table === "work_order_notes" && payload.eventType === "INSERT") {
      const n = payload.new as unknown as WorkOrderNote;
      const who = n.author_id ? lookups.staffById.get(n.author_id)?.full_name ?? "Personal" : "Personal";
      toast({
        title: n.is_issue ? `⚠️ Incidencia de ${who}` : `Observación de ${who}`,
        body: n.body,
        tone: n.is_issue ? "warning" : "info",
      });
    }
    if (table === "reservations" && payload.eventType === "INSERT") {
      const r = payload.new as unknown as Reservation;
      if (r.status === "pending") {
        toast({
          title: r.reference ? `Nueva solicitud desde la web (${r.reference})` : "Nueva reserva pendiente",
          body: `${r.guest_name} · ${r.requested_room_type ? `${r.requested_room_type} · ` : ""}${r.check_in} → ${r.check_out}`,
          tone: "warning",
        });
      }
    }
  });

  return (
    <div className="flex min-h-full">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <img src={logo} className="h-8 w-8" alt="" />
          <span className="font-bold">Hotel PMS</span>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cx(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
                  isActive ? "bg-brand-50 text-brand-800" : "text-slate-600 hover:bg-slate-50",
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
              {to === "/reservas" && pending > 0 && <PendingBadge count={pending} className="ml-auto" />}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-4">
          <p className="truncate text-sm font-medium">{profile?.full_name}</p>
          <p className="text-xs text-slate-500">Responsable</p>
          <button onClick={signOut} className="mt-3 flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
            <LogOut className="h-4 w-4" /> Cerrar sesión
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Navegación móvil */}
        <nav className="sticky top-0 z-30 flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-2 py-2 md:hidden">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cx(
                  "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium",
                  isActive ? "bg-brand-50 text-brand-800" : "text-slate-600",
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
              {to === "/reservas" && pending > 0 && <PendingBadge count={pending} />}
            </NavLink>
          ))}
          <button onClick={signOut} className="ml-auto shrink-0 px-2 text-slate-500" aria-label="Cerrar sesión">
            <LogOut className="h-4 w-4" />
          </button>
        </nav>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-8">
          <Outlet context={lookups} />
        </main>
      </div>
    </div>
  );
}

function PendingBadge({ count, className }: { count: number; className?: string }) {
  return (
    <span className={cx("min-w-5 rounded-full bg-amber-500 px-1.5 text-center text-[11px] leading-5 font-bold text-white", className)} title={`${count} pendientes de aceptar`}>
      {count}
    </span>
  );
}
