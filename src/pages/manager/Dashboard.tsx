import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addMonths, addWeeks, addYears, endOfMonth, endOfWeek, endOfYear, format, parseISO, startOfMonth, startOfWeek, startOfYear,
} from "date-fns";
import { es } from "date-fns/locale";
import { AlertTriangle, BedDouble, CheckCircle2, ChevronLeft, ChevronRight, Clock, Euro, Star, Ticket } from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useHotel } from "../../lib/outlet";
import { useRealtime } from "../../lib/useRealtime";
import { eur, fmtDateTime, toISODate } from "../../lib/format";
import { roomStatusLabel } from "../../lib/labels";
import type { DashboardStats, Reservation, RoomStatus, WorkOrder, WorkOrderNote } from "../../lib/types";
import { Card, PageHeader, Spinner, cx } from "../../components/ui";
import { RoomStatusBadge } from "../../components/StatusBadges";

type Period = "week" | "month" | "year";

function range(period: Period, anchor: Date) {
  if (period === "week") {
    return { from: startOfWeek(anchor, { weekStartsOn: 1 }), to: endOfWeek(anchor, { weekStartsOn: 1 }) };
  }
  if (period === "month") return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
  return { from: startOfYear(anchor), to: endOfYear(anchor) };
}

const shift = (period: Period, d: Date, n: number) =>
  period === "week" ? addWeeks(d, n) : period === "month" ? addMonths(d, n) : addYears(d, n);

// Recharts no lee variables CSS en todos los atributos: tonos fijos y neutros
const INK_MUTED = "#64748b";
const GRID = "#e2e8f0";
const SERIES = "#0f766e";

const roomStatusDot: Record<RoomStatus, string> = {
  clean: "bg-emerald-500",
  inspected: "bg-sky-500",
  cleaning: "bg-amber-500",
  dirty: "bg-rose-500",
  out_of_service: "bg-slate-400",
};

export default function Dashboard() {
  const { rooms, roomById, staffById } = useHotel();
  const [period, setPeriod] = useState<Period>("month");
  const [anchor, setAnchor] = useState(new Date());
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [notes, setNotes] = useState<(WorkOrderNote & { work_orders: Pick<WorkOrder, "room_id"> | null })[]>([]);
  const [today, setToday] = useState<{ arrivals: Reservation[]; departures: Reservation[]; pending: number }>({
    arrivals: [], departures: [], pending: 0,
  });

  const { from, to } = useMemo(() => range(period, anchor), [period, anchor]);

  const loadStats = useCallback(async () => {
    // to es inclusivo en pantalla; la RPC usa rango [from, to)
    const { data } = await supabase.rpc("dashboard_stats", {
      p_from: toISODate(from),
      p_to: toISODate(new Date(to.getTime() + 86400000)),
    });
    setStats(data as DashboardStats);
  }, [from, to]);

  const loadLive = useCallback(async () => {
    const t = toISODate(new Date());
    const [n, a, d, p] = await Promise.all([
      supabase.from("work_order_notes").select("*, work_orders(room_id)").order("created_at", { ascending: false }).limit(12),
      supabase.from("reservations").select("*").eq("check_in", t).in("status", ["confirmed", "checked_in"]),
      supabase.from("reservations").select("*").eq("check_out", t).in("status", ["confirmed", "checked_in", "checked_out"]),
      supabase.from("reservations").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);
    setNotes((n.data ?? []) as typeof notes);
    setToday({ arrivals: (a.data ?? []) as Reservation[], departures: (d.data ?? []) as Reservation[], pending: p.count ?? 0 });
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);
  useEffect(() => {
    loadLive();
  }, [loadLive]);

  useRealtime(["work_orders", "work_order_notes", "reservations"], () => {
    loadLive();
    loadStats();
  });

  const series = useMemo(() => {
    if (!stats) return [];
    const total = stats.total_rooms || 1;
    if (period !== "year") {
      return stats.occupancy_series.map((p) => ({
        label: format(parseISO(p.day), period === "week" ? "EEE d" : "d", { locale: es }),
        value: Math.round((100 * p.occupied) / total),
      }));
    }
    // En vista anual agregamos por mes
    const byMonth = new Map<string, { occ: number; days: number }>();
    for (const p of stats.occupancy_series) {
      const k = p.day.slice(0, 7);
      const cur = byMonth.get(k) ?? { occ: 0, days: 0 };
      byMonth.set(k, { occ: cur.occ + p.occupied, days: cur.days + 1 });
    }
    return [...byMonth.entries()].map(([k, v]) => ({
      label: format(parseISO(`${k}-01`), "MMM", { locale: es }),
      value: Math.round((100 * v.occ) / (total * v.days)),
    }));
  }, [stats, period]);

  const statusCounts = useMemo(() => {
    const c: Record<RoomStatus, number> = { clean: 0, inspected: 0, cleaning: 0, dirty: 0, out_of_service: 0 };
    rooms.filter((r) => r.active).forEach((r) => c[r.status]++);
    return c;
  }, [rooms]);
  const ready = statusCounts.clean + statusCounts.inspected;

  const periodLabel =
    period === "week"
      ? `${format(from, "d MMM", { locale: es })} – ${format(to, "d MMM yyyy", { locale: es })}`
      : period === "month"
        ? format(from, "MMMM yyyy", { locale: es })
        : format(from, "yyyy");

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Ocupación, limpieza y feedback del equipo en tiempo real"
        actions={
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg bg-white p-1 ring-1 ring-slate-200">
              {(["week", "month", "year"] as Period[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={cx(
                    "rounded-md px-3 py-1 text-sm font-medium",
                    period === p ? "bg-brand-700 text-white" : "text-slate-600 hover:bg-slate-50",
                  )}
                >
                  {p === "week" ? "Semana" : p === "month" ? "Mes" : "Año"}
                </button>
              ))}
            </div>
            <div className="flex items-center rounded-lg bg-white ring-1 ring-slate-200">
              <button className="p-2 hover:bg-slate-50" onClick={() => setAnchor(shift(period, anchor, -1))} aria-label="Anterior">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-36 px-2 text-center text-sm font-medium capitalize">{periodLabel}</span>
              <button className="p-2 hover:bg-slate-50" onClick={() => setAnchor(shift(period, anchor, 1))} aria-label="Siguiente">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        }
      />

      {/* Estado en vivo */}
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Disponibilidad ahora</h2>
            <span className="flex items-center gap-1.5 text-xs text-emerald-700">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> En vivo
            </span>
          </div>
          <p className="mb-3 text-sm text-slate-600">
            <span className="text-2xl font-bold text-slate-900">{ready}</span> de {rooms.filter((r) => r.active).length} habitaciones
            listas para entrar
          </p>
          <div className="grid grid-cols-5 gap-2 sm:grid-cols-8 lg:grid-cols-10">
            {rooms.filter((r) => r.active).map((r) => (
              <Link
                key={r.id}
                to="/habitaciones"
                title={`${r.number} · ${roomStatusLabel[r.status]}`}
                className="flex flex-col items-center rounded-lg p-2 ring-1 ring-slate-200 hover:bg-slate-50"
              >
                <span className="text-sm font-semibold">{r.number}</span>
                <span className={cx("mt-1 h-2 w-2 rounded-full", roomStatusDot[r.status])} />
              </Link>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-600">
            {(Object.keys(statusCounts) as RoomStatus[]).map((s) => (
              <span key={s} className="flex items-center gap-1.5">
                <span className={cx("h-2 w-2 rounded-full", roomStatusDot[s])} /> {roomStatusLabel[s]}: {statusCounts[s]}
              </span>
            ))}
          </div>
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Hoy</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-600">Llegadas</dt><dd className="font-semibold">{today.arrivals.length}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-600">Salidas</dt><dd className="font-semibold">{today.departures.length}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-600">Hab. sucias / en limpieza</dt><dd className="font-semibold">{statusCounts.dirty} / {statusCounts.cleaning}</dd></div>
          </dl>
          {today.pending > 0 && (
            <Link to="/reservas" className="mt-4 flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm font-medium text-amber-800 ring-1 ring-amber-200">
              <Ticket className="h-4 w-4" /> {today.pending} reserva(s) pendientes de aceptar →
            </Link>
          )}
        </Card>
      </div>

      {!stats ? (
        <Spinner />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Kpi icon={BedDouble} label="Ocupación" value={`${stats.occupancy_pct ?? 0}%`} sub={`${stats.room_nights_sold} noches vendidas`} />
            <Kpi icon={Euro} label="Ingresos (llegadas)" value={eur(stats.revenue)} sub="Reservas con importe" />
            <Kpi icon={CheckCircle2} label="Limpiezas hechas" value={`${stats.orders_done}/${stats.orders_total}`} sub={`${stats.orders_issue} con incidencia`} />
            <Kpi
              icon={Clock}
              label="Tiempo medio limpieza"
              value={stats.avg_clean_minutes ? `${stats.avg_clean_minutes} min` : "—"}
              sub={stats.avg_room_rating ? `Estado medio al entrar: ${stats.avg_room_rating}/5` : "Sin valoraciones"}
            />
          </div>

          <div className="mb-6 grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <h2 className="font-semibold">Ocupación (%)</h2>
              <p className="mb-2 text-xs text-slate-500">{period === "year" ? "Media mensual" : "Por día"}</p>
              <div className="h-64">
                <ResponsiveContainer>
                  <AreaChart data={series} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: INK_MUTED }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: INK_MUTED }} tickLine={false} axisLine={false} unit="%" />
                    <Tooltip formatter={(v) => [`${v}%`, "Ocupación"]} cursor={{ stroke: INK_MUTED, strokeDasharray: "3 3" }} />
                    <Area type="monotone" dataKey="value" stroke={SERIES} strokeWidth={2} fill={SERIES} fillOpacity={0.12} activeDot={{ r: 4 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card>
              <h2 className="mb-3 font-semibold">Reservas por canal</h2>
              {stats.reservations_by_source.length === 0 ? (
                <p className="text-sm text-slate-500">Sin reservas en el periodo.</p>
              ) : (
                <ul className="space-y-3">
                  {(() => {
                    const max = Math.max(...stats.reservations_by_source.map((s) => s.count));
                    return stats.reservations_by_source
                      .slice()
                      .sort((a, b) => b.count - a.count)
                      .map((s) => (
                        <li key={s.source}>
                          <div className="mb-1 flex justify-between text-sm">
                            <span className="flex items-center gap-2">
                              <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} /> {s.source}
                            </span>
                            <span className="font-medium">{s.count}</span>
                          </div>
                          <div className="h-2 rounded-full bg-slate-100">
                            <div className="h-2 rounded-full" style={{ width: `${(100 * s.count) / max}%`, background: s.color }} />
                          </div>
                        </li>
                      ));
                  })()}
                </ul>
              )}
            </Card>
          </div>

          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="mb-3 font-semibold">Rendimiento del equipo de limpieza</h2>
              {stats.by_cleaner.length === 0 ? (
                <p className="text-sm text-slate-500">Sin órdenes asignadas en el periodo.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-slate-500">
                    <tr>
                      <th className="pb-2 font-medium">Limpiadora</th>
                      <th className="pb-2 text-right font-medium">Hechas</th>
                      <th className="pb-2 text-right font-medium">Min. medios</th>
                      <th className="pb-2 text-right font-medium">Observaciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {stats.by_cleaner.map((c) => (
                      <tr key={c.name}>
                        <td className="py-2 font-medium">{c.name}</td>
                        <td className="py-2 text-right">{c.done}/{c.total}</td>
                        <td className="py-2 text-right">{c.avg_minutes ?? "—"}</td>
                        <td className="py-2 text-right">{c.notes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
            <Card>
              <h2 className="mb-3 font-semibold">Incidencias por habitación</h2>
              {stats.issues_by_room.length === 0 ? (
                <p className="text-sm text-slate-500">Ninguna incidencia reportada en el periodo. 👍</p>
              ) : (
                <div className="h-56">
                  <ResponsiveContainer>
                    <BarChart data={stats.issues_by_room} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                      <CartesianGrid stroke={GRID} vertical={false} />
                      <XAxis dataKey="room" tick={{ fontSize: 11, fill: INK_MUTED }} tickLine={false} axisLine={false} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: INK_MUTED }} tickLine={false} axisLine={false} />
                      <Tooltip formatter={(v) => [v, "Incidencias"]} labelFormatter={(l) => `Hab. ${l}`} cursor={{ fill: "#f1f5f9" }} />
                      <Bar dataKey="issues" fill="#e34948" radius={[4, 4, 0, 0]} maxBarSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Últimas observaciones de las limpiadoras</h2>
          <Link to="/ordenes" className="text-sm text-brand-700 hover:underline">Ver órdenes</Link>
        </div>
        {notes.length === 0 ? (
          <p className="text-sm text-slate-500">Aún no hay observaciones.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {notes.map((n) => {
              const room = n.work_orders ? roomById.get(n.work_orders.room_id) : undefined;
              return (
                <li key={n.id} className="flex gap-3 py-3">
                  {n.is_issue ? (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-label="Incidencia" />
                  ) : (
                    <Star className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-label="Observación" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{n.body}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span>{n.author_id ? staffById.get(n.author_id)?.full_name : "—"}</span>
                      {room && <>· Hab. {room.number} <RoomStatusBadge status={room.status} /></>}
                      <span>· {fmtDateTime(n.created_at)}</span>
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}

function Kpi({ icon: Icon, label, value, sub }: { icon: typeof BedDouble; label: string; value: string; sub?: string }) {
  return (
    <Card>
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Icon className="h-4 w-4" /> {label}
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </Card>
  );
}
