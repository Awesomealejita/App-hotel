import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Bell, X } from "lucide-react";
import { cx } from "./ui";

interface Toast {
  id: number;
  title: string;
  body?: string;
  tone?: "info" | "success" | "warning" | "error";
}

const ToastContext = createContext<(t: Omit<Toast, "id">) => void>(() => {});

const tones = {
  info: "border-l-sky-500",
  success: "border-l-emerald-500",
  warning: "border-l-amber-500",
  error: "border-l-rose-500",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-4), { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 6000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx("pointer-events-auto flex gap-3 rounded-lg border-l-4 bg-white p-3 shadow-lg ring-1 ring-slate-200", tones[t.tone ?? "info"])}
          >
            <Bell className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t.title}</p>
              {t.body && <p className="mt-0.5 text-sm text-slate-600">{t.body}</p>}
            </div>
            <button onClick={() => setToasts((p) => p.filter((x) => x.id !== t.id))} className="text-slate-400 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
