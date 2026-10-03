import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { cx } from "../components/ui";

type DemoApi = { switchUser: (id: string) => void; currentUser: () => string | null };

/** Barra flotante del mockup para cambiar entre la vista de responsable y la de limpiadora. */
export default function DemoBar() {
  const demo = (supabase as unknown as { __demo?: DemoApi }).__demo;
  const [user, setUser] = useState(demo?.currentUser() ?? null);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(() => setUser(demo?.currentUser() ?? null));
    return () => data.subscription.unsubscribe();
  }, [demo]);

  if (!demo) return null;
  const views = [
    { id: "u-laura", label: "Responsable", sub: "Laura · escritorio" },
    { id: "u-ana", label: "Limpiadora", sub: "Ana · móvil" },
  ];
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-slate-900 px-4 py-1.5 text-white">
      <span className="text-xs font-semibold tracking-wide text-teal-300 uppercase">Mockup · datos de ejemplo</span>
      <div className="flex gap-1 rounded-full bg-white/10 p-0.5">
        {views.map((v) => (
          <button
            key={v.id}
            onClick={() => demo.switchUser(v.id)}
            className={cx("rounded-full px-3 py-1 text-xs", user === v.id ? "bg-white font-semibold text-slate-900" : "text-white/80 hover:bg-white/10")}
          >
            {v.label} <span className="hidden opacity-60 sm:inline">· {v.sub}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
