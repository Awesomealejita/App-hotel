import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, Camera, Check, ChevronLeft, Play, Send } from "lucide-react";
import { supabase, PHOTO_BUCKET } from "../../lib/supabase";
import { useAuth } from "../../auth/AuthProvider";
import { useHotel } from "../../lib/outlet";
import { useRealtime } from "../../lib/useRealtime";
import { errorMessage, fmtTime } from "../../lib/format";
import { orderTypeLabel } from "../../lib/labels";
import type { ChecklistItem, WorkOrder, WorkOrderNote } from "../../lib/types";
import { Button, Spinner, Textarea, cx } from "../../components/ui";
import { OrderStatusBadge } from "../../components/StatusBadges";
import OrderTimeline from "../../components/OrderTimeline";
import { useToast } from "../../components/Toaster";

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const { roomById, staffById } = useHotel();
  const toast = useToast();
  const navigate = useNavigate();
  const [order, setOrder] = useState<WorkOrder | null>(null);
  const [notes, setNotes] = useState<WorkOrderNote[]>([]);
  const [body, setBody] = useState("");
  const [isIssue, setIsIssue] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [o, n] = await Promise.all([
      supabase.from("work_orders").select("*").eq("id", id!).single(),
      supabase.from("work_order_notes").select("*").eq("work_order_id", id!).order("created_at"),
    ]);
    setOrder(o.data as WorkOrder);
    setNotes((n.data ?? []) as WorkOrderNote[]);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);
  useRealtime(["work_order_notes"], () => load(), `work_order_id=eq.${id}`);

  if (!order) return <Spinner />;
  const room = roomById.get(order.room_id);
  const locked = order.status === "done" || order.status === "verified";
  const doneCount = order.checklist.filter((c) => c.done).length;
  const allDone = doneCount === order.checklist.length;

  const patch = async (p: Partial<WorkOrder>) => {
    const prev = order;
    setOrder({ ...order, ...p }); // optimista
    const { error } = await supabase.from("work_orders").update(p).eq("id", order.id);
    if (error) {
      setOrder(prev);
      toast({ title: "No se guardó", body: error.message, tone: "error" });
      return false;
    }
    return true;
  };

  const toggle = (item: ChecklistItem) => {
    if (locked) return;
    const checklist = order.checklist.map((c) => (c.key === item.key ? { ...c, done: !c.done } : c));
    patch({ checklist, ...(order.status === "pending" ? { status: "in_progress" as const } : {}) });
  };

  const start = () => patch({ status: "in_progress" });

  const finish = async () => {
    if (!allDone && !confirm(`Faltan ${order.checklist.length - doneCount} puntos del checklist. ¿Terminar igualmente?`)) return;
    setBusy(true);
    const ok = await patch({ status: "done" });
    setBusy(false);
    if (ok) {
      toast({ title: "¡Habitación terminada!", body: "El responsable ya lo está viendo.", tone: "success" });
      navigate("/");
    }
  };

  const sendNote = async () => {
    if (!body.trim() && !photo) return;
    setSending(true);
    try {
      let photo_path: string | null = null;
      if (photo) {
        const ext = photo.name.split(".").pop() || "jpg";
        photo_path = `${profile!.id}/${order.id}/${Date.now()}.${ext}`;
        const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(photo_path, photo, { contentType: photo.type });
        if (error) throw error;
      }
      const { error } = await supabase.from("work_order_notes").insert({
        work_order_id: order.id,
        author_id: profile!.id,
        body: body.trim() || "📷 Foto",
        is_issue: isIssue,
        photo_path,
      });
      if (error) throw error;
      if (isIssue && order.status !== "done") await patch({ status: "issue" });
      setBody("");
      setPhoto(null);
      setIsIssue(false);
      load();
    } catch (e) {
      toast({ title: "No se pudo enviar", body: errorMessage(e), tone: "error" });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-slate-600"><ChevronLeft className="h-4 w-4" /> Mis tareas</Link>

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-3xl font-bold">Hab. {room?.number}</p>
            <p className="text-sm text-slate-500">{orderTypeLabel[order.order_type]} · {room?.room_type}</p>
          </div>
          <OrderStatusBadge status={order.status} />
        </div>
        {order.instructions && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">📌 {order.instructions}</p>}
        {order.started_at && <p className="mt-2 text-xs text-slate-500">Empezada a las {fmtTime(order.started_at)}{order.completed_at && ` · terminada a las ${fmtTime(order.completed_at)}`}</p>}
        {order.status === "pending" && (
          <Button onClick={start} className="mt-4 w-full py-3 text-base"><Play className="h-5 w-5" /> Empezar limpieza</Button>
        )}
      </div>

      {order.checklist.length > 0 && (
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Checklist</h2>
            <span className="text-sm text-slate-500">{doneCount}/{order.checklist.length}</span>
          </div>
          <div className="mb-3 h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-emerald-500 transition-all" style={{ width: `${(100 * doneCount) / order.checklist.length}%` }} />
          </div>
          <ul className="space-y-2">
            {order.checklist.map((item) => (
              <li key={item.key}>
                <button
                  onClick={() => toggle(item)}
                  disabled={locked}
                  className={cx(
                    "flex w-full items-center gap-3 rounded-xl p-3 text-left ring-1 transition active:scale-[0.99]",
                    item.done ? "bg-emerald-50 ring-emerald-200" : "bg-white ring-slate-200",
                  )}
                >
                  <span className={cx("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2", item.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300")}>
                    {item.done && <Check className="h-4 w-4" strokeWidth={3} />}
                  </span>
                  <span className={cx("text-[15px]", item.done && "text-slate-500 line-through")}>{item.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="mb-2 font-semibold">¿Cómo encontraste la habitación?</h2>
        <div className="flex justify-between gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              disabled={locked}
              onClick={() => patch({ rating: n })}
              className={cx("flex-1 rounded-xl py-2 text-2xl", (order.rating ?? 0) >= n ? "text-amber-400" : "text-slate-200")}
              aria-label={`${n} estrellas`}
            >
              ★
            </button>
          ))}
        </div>
        <p className="mt-1 text-center text-xs text-slate-500">1 = muy sucia / con daños · 5 = perfecta</p>
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="mb-3 font-semibold">Observaciones</h2>
        <OrderTimeline notes={notes} staffById={staffById} />
        <div className="mt-4 space-y-2">
          <Textarea
            rows={3}
            placeholder="Escribe una observación: falta algo, algo roto, objetos olvidados…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setIsIssue(!isIssue)}
              className={cx("flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium ring-1", isIssue ? "bg-rose-600 text-white ring-rose-600" : "text-rose-700 ring-rose-200")}
            >
              <AlertTriangle className="h-4 w-4" /> Es una incidencia
            </button>
            <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300">
              <Camera className="h-4 w-4" /> {photo ? "Foto ✓" : "Foto"}
            </button>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
            <Button onClick={sendNote} loading={sending} className="ml-auto"><Send className="h-4 w-4" /> Enviar</Button>
          </div>
        </div>
      </div>

      {!locked && order.status !== "pending" && (
        <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-xl border-t border-slate-200 bg-white/95 p-4 backdrop-blur">
          <Button variant="success" onClick={finish} loading={busy} className="w-full py-3.5 text-base">
            <Check className="h-5 w-5" /> Habitación terminada {order.checklist.length > 0 && `(${doneCount}/${order.checklist.length})`}
          </Button>
        </div>
      )}
    </div>
  );
}
