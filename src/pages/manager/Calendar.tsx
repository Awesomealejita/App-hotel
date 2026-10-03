import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, differenceInCalendarDays, format, isToday, isWeekend, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { syncIcal } from "../../lib/api";
import { useHotel } from "../../lib/outlet";
import { useRealtime } from "../../lib/useRealtime";
import { errorMessage, toISODate } from "../../lib/format";
import type { Reservation } from "../../lib/types";
import { Button, PageHeader, Select, cx } from "../../components/ui";
import { useToast } from "../../components/Toaster";
import ReservationDetail from "../../components/ReservationDetail";

const DAY_W = 44; // px por día

export default function CalendarPage() {
  const lookups = useHotel();
  const { rooms, sources, sourceById } = lookups;
  const toast = useToast();
  const [start, setStart] = useState(() => addDays(new Date(), -2));
  const [span, setSpan] = useState(21);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [selected, setSelected] = useState<Reservation | null>(null);
  const [syncing, setSyncing] = useState(false);

  const days = useMemo(() => Array.from({ length: span }, (_, i) => addDays(start, i)), [start, span]);
  const from = toISODate(start);
  const to = toISODate(addDays(start, span));

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("reservations")
      .select("*")
      .lt("check_in", to)
      .gt("check_out", from)
      .in("status", ["pending", "confirmed", "checked_in", "checked_out"]);
    setReservations((data ?? []) as Reservation[]);
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);
  useRealtime(["reservations"], () => load());

  const sync = async () => {
    setSyncing(true);
    try {
      const res = await syncIcal();
      const created = res.feeds.reduce((a, f) => a + (f.created ?? 0), 0);
      const errors = res.feeds.filter((f) => f.error);
      toast({
        title: "Sincronización completada",
        body: `${res.feeds.length} calendarios · ${created} reservas nuevas${errors.length ? ` · ${errors.length} con error` : ""}`,
        tone: errors.length ? "warning" : "success",
      });
      load();
    } catch (e) {
      toast({ title: "Error al sincronizar", body: errorMessage(e), tone: "error" });
    } finally {
      setSyncing(false);
    }
  };

  const rows = [
    ...rooms.filter((r) => r.active).map((r) => ({ id: r.id, label: r.number, sub: r.room_type })),
    ...(reservations.some((r) => !r.room_id) ? [{ id: "", label: "Sin asignar", sub: "" }] : []),
  ];

  const occupiedToday = new Set(
    reservations
      .filter((r) => ["confirmed", "checked_in"].includes(r.status) && r.check_in <= toISODate(new Date()) && r.check_out > toISODate(new Date()))
      .map((r) => r.room_id),
  ).size;

  return (
    <>
      <PageHeader
        title="Calendario de reservas"
        subtitle={`Booking, Airbnb, Expedia y directas en una sola vista · ${rooms.length - occupiedToday} habitaciones libres hoy`}
        actions={
          <>
            <Select value={span} onChange={(e) => setSpan(Number(e.target.value))} className="w-32">
              <option value={14}>2 semanas</option>
              <option value={21}>3 semanas</option>
              <option value={31}>1 mes</option>
              <option value={62}>2 meses</option>
            </Select>
            <div className="flex items-center rounded-lg bg-white ring-1 ring-slate-300">
              <button className="p-2 hover:bg-slate-50" onClick={() => setStart(addDays(start, -7))} aria-label="Anterior"><ChevronLeft className="h-4 w-4" /></button>
              <button className="px-2 text-sm font-medium" onClick={() => setStart(addDays(new Date(), -2))}>Hoy</button>
              <button className="p-2 hover:bg-slate-50" onClick={() => setStart(addDays(start, 7))} aria-label="Siguiente"><ChevronRight className="h-4 w-4" /></button>
            </div>
            <Button onClick={sync} loading={syncing} variant="secondary">
              {!syncing && <RefreshCw className="h-4 w-4" />} Sincronizar canales
            </Button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap gap-4 text-xs text-slate-600">
        {sources.map((s) => (
          <span key={s.id} className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded" style={{ background: s.color }} /> {s.name}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded border-2 border-dashed border-slate-500" /> Pendiente de aceptar
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <div style={{ minWidth: 96 + span * DAY_W }}>
          {/* Cabecera de días */}
          <div className="sticky top-0 z-10 flex border-b border-slate-200 bg-white">
            <div className="sticky left-0 z-20 w-24 shrink-0 border-r border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-500">Hab.</div>
            {days.map((d) => (
              <div
                key={d.toISOString()}
                style={{ width: DAY_W }}
                className={cx(
                  "shrink-0 border-r border-slate-100 py-1 text-center text-[11px] leading-tight",
                  isToday(d) ? "bg-brand-50 font-bold text-brand-800" : isWeekend(d) ? "bg-slate-50 text-slate-500" : "text-slate-500",
                )}
              >
                <div className="capitalize">{format(d, "EEEEEE", { locale: es })}</div>
                <div className="text-sm text-slate-800">{format(d, "d")}</div>
                {d.getDate() === 1 && <div className="capitalize">{format(d, "MMM", { locale: es })}</div>}
              </div>
            ))}
          </div>

          {rows.map((row) => {
            const rowRes = reservations.filter((r) => (r.room_id ?? "") === row.id);
            return (
              <div key={row.id || "unassigned"} className="flex border-b border-slate-100 last:border-0">
                <div className="sticky left-0 z-10 w-24 shrink-0 border-r border-slate-200 bg-white px-3 py-2">
                  <div className="text-sm font-semibold">{row.label}</div>
                  <div className="text-[11px] text-slate-500">{row.sub}</div>
                </div>
                <div className="relative flex-1">
                  {/* fondo: hoy y fines de semana */}
                  <div className="absolute inset-0 flex">
                    {days.map((d, i) => (
                      <div
                        key={i}
                        style={{ width: DAY_W }}
                        className={cx("shrink-0 border-r border-slate-50", isToday(d) && "bg-brand-50/60", isWeekend(d) && !isToday(d) && "bg-slate-50/60")}
                      />
                    ))}
                  </div>
                  <div
                    className="relative grid min-h-11 content-center gap-y-1 py-1.5"
                    style={{ gridTemplateColumns: `repeat(${span}, ${DAY_W}px)`, gridAutoRows: "26px", gridAutoFlow: "row dense" }}
                  >
                  {rowRes.map((r) => {
                    const s = Math.max(0, differenceInCalendarDays(parseISO(r.check_in), start));
                    const e = Math.min(span, differenceInCalendarDays(parseISO(r.check_out), start));
                    if (e <= s) return null;
                    const color = (r.source_id && sourceById.get(r.source_id)?.color) || "#0ea5e9";
                    const pending = r.status === "pending";
                    return (
                      <button
                        key={r.id}
                        onClick={() => setSelected(r)}
                        title={`${r.guest_name} · ${r.check_in} → ${r.check_out}`}
                        style={{
                          gridColumn: `${s + 1} / ${e + 1}`,
                          background: pending ? "#fff" : color,
                          borderColor: color,
                          color: pending ? color : "#fff",
                        }}
                        className={cx(
                          "relative z-[1] mx-0.5 truncate rounded-md px-1.5 text-left text-xs font-medium shadow-sm hover:brightness-110",
                          pending ? "border-2 border-dashed" : "border",
                          r.status === "checked_out" && "opacity-50",
                        )}
                      >
                        {r.guest_name}
                      </button>
                    );
                  })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <ReservationDetail reservation={selected} onClose={() => setSelected(null)} onChanged={load} lookups={lookups} />
    </>
  );
}
