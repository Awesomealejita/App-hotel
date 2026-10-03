import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Check, ChevronDown, ListChecks, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { cx } from "../components/ui";

type Action = { table: string; eventType: string; row: Record<string, any>; old: Record<string, any>; user: string | null };
type DemoApi = {
  switchUser: (id: string) => void;
  currentUser: () => string | null;
  onAction: (cb: (a: Action) => void) => () => void;
};

const MANAGER = "u-pilar";
const CLEANER = "u-ana";
const GUEST = "guest";

const views = [
  { id: GUEST, label: "Cliente", sub: "formulario web" },
  { id: MANAGER, label: "Responsable", sub: "Mª Pilar · escritorio" },
  { id: CLEANER, label: "Limpiadora", sub: "Ana · móvil" },
];

// Prueba guiada: cada paso se marca solo cuando se hace de verdad en la app
const steps: { who: string; title: string; where: string; done: (a: Action) => boolean }[] = [
  {
    who: GUEST, title: "Pide una reserva desde la web del hotel", where: "Elige fechas → Ver disponibilidad → elige habitación → rellena tus datos → Enviar solicitud",
    done: (a) => a.table === "reservations" && a.eventType === "INSERT" && !!a.row.reference,
  },
  {
    who: MANAGER, title: "Acepta la solicitud que ha llegado", where: "Reservas (verás el aviso naranja) → abre la solicitud web → elige habitación → Aceptar",
    done: (a) => a.table === "reservations" && a.row.status === "confirmed" && a.old.status === "pending",
  },
  {
    who: MANAGER, title: "Crea una orden de limpieza para Ana", where: "Órdenes → Nueva orden → elige habitación y asigna a Ana Pérez",
    done: (a) => a.table === "work_orders" && a.eventType === "INSERT" && a.row.assigned_to === CLEANER,
  },
  {
    who: CLEANER, title: "Empieza una limpieza", where: "Abre una tarea pendiente → Empezar limpieza",
    done: (a) => a.table === "work_orders" && a.user === CLEANER && a.row.status === "in_progress" && a.old.status === "pending",
  },
  {
    who: CLEANER, title: "Marca puntos del checklist", where: "Toca las casillas de la lista",
    done: (a) => a.table === "work_orders" && a.user === CLEANER && JSON.stringify(a.row.checklist) !== JSON.stringify(a.old.checklist),
  },
  {
    who: CLEANER, title: "Reporta una incidencia", where: "Observaciones → escribe → «Es una incidencia» → Enviar (puedes adjuntar foto)",
    done: (a) => a.table === "work_order_notes" && a.user === CLEANER && a.row.is_issue,
  },
  {
    who: CLEANER, title: "Termina la habitación", where: "Botón verde «Habitación terminada»",
    done: (a) => a.table === "work_orders" && a.user === CLEANER && a.row.status === "done" && a.old.status !== "done",
  },
  {
    who: MANAGER, title: "Revisa el aviso y verifica la habitación", where: "Órdenes → abre la habitación de Ana → Verificar",
    done: (a) => a.table === "work_orders" && a.user === MANAGER && a.row.status === "verified" && a.row.assigned_to === CLEANER,
  },
];

/** Barra superior del mockup: cambio de vista responsable/limpiadora y prueba guiada. */
export default function DemoBar() {
  const demo = (supabase as unknown as { __demo?: DemoApi }).__demo;
  const navigate = useNavigate();
  const location = useLocation();
  const [sessionUser, setUser] = useState(demo?.currentUser() ?? null);
  const user = location.pathname.startsWith("/reservar") ? GUEST : sessionUser;
  const go = (id: string) => {
    if (id === GUEST) {
      navigate("/reservar");
      return;
    }
    demo?.switchUser(id);
    navigate("/");
  };
  const [done, setDone] = useState<boolean[]>(() => steps.map(() => false));
  const [open, setOpen] = useState(() => window.innerWidth >= 640);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(() => setUser(demo?.currentUser() ?? null));
    return () => data.subscription.unsubscribe();
  }, [demo]);

  useEffect(
    () =>
      demo?.onAction((a) =>
        setDone((prev) => {
          // Los pasos van en orden: solo cuenta el siguiente pendiente
          const next = prev.indexOf(false);
          if (next < 0 || !steps[next].done(a)) return prev;
          const copy = [...prev];
          copy[next] = true;
          return copy;
        }),
      ),
    [demo],
  );

  if (!demo) return null;
  const current = done.indexOf(false);
  const count = done.filter(Boolean).length;
  const needsSwitch = current >= 0 && steps[current].who !== user;
  const target = current >= 0 ? views.find((v) => v.id === steps[current].who)! : null;

  return (
    <div className="relative z-40">
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-slate-900 px-4 py-1.5 text-white">
        <span className="text-xs font-semibold tracking-wide text-teal-300 uppercase">Mockup · datos de ejemplo</span>
        <div className="flex gap-1 rounded-full bg-white/10 p-0.5">
          {views.map((v) => (
            <button
              key={v.id}
              onClick={() => go(v.id)}
              className={cx("rounded-full px-3 py-1 text-xs", user === v.id ? "bg-white font-semibold text-slate-900" : "text-white/80 hover:bg-white/10")}
            >
              {v.label} <span className="hidden opacity-60 sm:inline">· {v.sub}</span>
            </button>
          ))}
        </div>
        <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-teal-200 ring-1 ring-teal-400/40 hover:bg-white/10">
          <ListChecks className="h-3.5 w-3.5" /> Prueba guiada {count}/{steps.length}
          <ChevronDown className={cx("h-3.5 w-3.5 transition", open && "rotate-180")} />
        </button>
        {current >= 0 && (
          <span className="w-full text-center text-xs text-white/80 sm:w-auto">
            Paso {current + 1}: <b className="text-white">{steps[current].title}</b>
            {needsSwitch && target && (
              <button onClick={() => go(target.id)} className="ml-2 rounded-full bg-teal-600 px-2 py-0.5 font-semibold text-white">
                Ir a {target.label.toLowerCase()} →
              </button>
            )}
          </span>
        )}
      </div>

      {open && (
        <div className="fixed right-2 bottom-2 left-2 max-h-[70vh] overflow-y-auto rounded-xl bg-white p-4 text-slate-800 shadow-2xl ring-1 ring-slate-200 sm:right-auto sm:bottom-4 sm:left-4 sm:w-96">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold">Prueba guiada</p>
              <p className="text-xs text-slate-500">Haz el recorrido completo: un cliente pide reserva en la web, la responsable la acepta y organiza, la limpiadora trabaja desde el móvil y la responsable lo ve al momento.</p>
            </div>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700" aria-label="Ocultar"><X className="h-4 w-4" /></button>
          </div>
          <ol className="space-y-1.5">
            {steps.map((s, i) => {
              const who = views.find((v) => v.id === s.who)!;
              const isCurrent = i === current;
              return (
                <li key={i} className={cx("flex gap-2.5 rounded-lg p-2", isCurrent && "bg-teal-50 ring-1 ring-teal-200")}>
                  <span className={cx("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold", done[i] ? "bg-emerald-500 text-white" : isCurrent ? "bg-teal-700 text-white" : "bg-slate-200 text-slate-500")}>
                    {done[i] ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className={cx("text-sm", done[i] ? "text-slate-400 line-through" : "font-medium")}>
                      {s.title} <span className="text-xs font-normal text-slate-500">· {who.label}</span>
                    </p>
                    {isCurrent && <p className="text-xs text-slate-600">{s.where}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
          {needsSwitch && target && (
            <button onClick={() => go(target.id)} className="mt-3 w-full rounded-lg bg-teal-700 py-2 text-sm font-semibold text-white hover:bg-teal-800">
              Cambiar a la vista de {target.label.toLowerCase()} ({target.sub.split(" · ")[0]})
            </button>
          )}
          {current < 0 && (
            <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
              ¡Prueba completada! Del formulario web a la habitación verificada. Mira el Dashboard: todo ya cuenta en los indicadores.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
