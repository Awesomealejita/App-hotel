import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useHotel } from "../../lib/outlet";
import { errorMessage, fmtDateTime } from "../../lib/format";
import { orderTypeLabel } from "../../lib/labels";
import type { ChecklistTemplate, IcalFeed, Room, UserRole, WorkOrderType } from "../../lib/types";
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Textarea, cx } from "../../components/ui";
import { useToast } from "../../components/Toaster";

const sections = [
  { key: "staff", label: "Personal" },
  { key: "channels", label: "Canales e iCal" },
  { key: "checklists", label: "Checklists" },
  { key: "rooms", label: "Habitaciones" },
] as const;

export default function SettingsPage() {
  const [section, setSection] = useState<(typeof sections)[number]["key"]>("staff");
  return (
    <>
      <PageHeader title="Ajustes" />
      <div className="mb-6 flex flex-wrap gap-2">
        {sections.map((s) => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            className={cx("rounded-lg px-3 py-1.5 text-sm font-medium", section === s.key ? "bg-brand-700 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200")}
          >
            {s.label}
          </button>
        ))}
      </div>
      {section === "staff" && <Staff />}
      {section === "channels" && <Channels />}
      {section === "checklists" && <Checklists />}
      {section === "rooms" && <RoomsAdmin />}
    </>
  );
}

function Staff() {
  const { staff, reload } = useHotel();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ full_name: "", email: "", password: "", phone: "", role: "cleaner" as UserRole });
  const [saving, setSaving] = useState(false);

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const { data, error } = await supabase.functions.invoke("invite-user", { body: form });
    setSaving(false);
    if (error || data?.error) {
      toast({ title: "No se pudo crear el usuario", body: data?.error ?? errorMessage(error), tone: "error" });
      return;
    }
    toast({ title: "Usuario creado", body: `${form.full_name} ya puede entrar con su email y contraseña`, tone: "success" });
    setOpen(false);
    setForm({ full_name: "", email: "", password: "", phone: "", role: "cleaner" });
    reload();
  };

  const update = async (id: string, patch: Record<string, unknown>) => {
    const { error } = await supabase.from("profiles").update(patch).eq("id", id);
    if (error) toast({ title: "Error", body: error.message, tone: "error" });
    reload();
  };

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">Personal del hotel</h2>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Añadir persona</Button>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-500">
          <tr><th className="pb-2 font-medium">Nombre</th><th className="pb-2 font-medium">Teléfono</th><th className="pb-2 font-medium">Rol</th><th className="pb-2 font-medium">Activo</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {staff.map((p) => (
            <tr key={p.id}>
              <td className="py-2 font-medium">{p.full_name}</td>
              <td className="py-2 text-slate-600">{p.phone ?? "—"}</td>
              <td className="py-2">
                <Select value={p.role} onChange={(e) => update(p.id, { role: e.target.value })} className="w-40 py-1 text-xs">
                  <option value="cleaner">Limpieza</option>
                  <option value="manager">Responsable</option>
                </Select>
              </td>
              <td className="py-2">
                <input type="checkbox" checked={p.active} onChange={(e) => update(p.id, { active: e.target.checked })} className="h-4 w-4 accent-brand-700" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Modal open={open} onClose={() => setOpen(false)} title="Añadir persona">
        <form onSubmit={invite} className="space-y-3">
          <Field label="Nombre completo"><Input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
          <Field label="Email (usuario de acceso)"><Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Contraseña inicial" hint="Mínimo 8 caracteres. Compártela con la persona."><Input required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
          <Field label="Teléfono"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="Rol">
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}>
              <option value="cleaner">Limpieza</option>
              <option value="manager">Responsable</option>
            </Select>
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" loading={saving}>Crear usuario</Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}

function Channels() {
  const { rooms, sources, roomById, sourceById, reload } = useHotel();
  const toast = useToast();
  const [feeds, setFeeds] = useState<IcalFeed[]>([]);
  const [form, setForm] = useState({ room_id: "", source_id: "", url: "" });

  const load = useCallback(async () => {
    const { data } = await supabase.from("ical_feeds").select("*");
    setFeeds((data ?? []) as IcalFeed[]);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const addFeed = async (e: FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("ical_feeds").upsert(form, { onConflict: "room_id,source_id" });
    if (error) toast({ title: "Error", body: error.message, tone: "error" });
    else {
      setForm({ ...form, url: "" });
      load();
    }
  };

  const removeFeed = async (id: string) => {
    await supabase.from("ical_feeds").delete().eq("id", id);
    load();
  };

  const updateSource = async (id: string, patch: Record<string, unknown>) => {
    await supabase.from("booking_sources").update(patch).eq("id", id);
    reload();
  };

  const exportUrl = (r: Room) =>
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ical-export?room=${r.id}&token=${r.ical_token}`;

  const copy = (text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => toast({ title: "Copiado", tone: "success" }))
      .catch(() => toast({ title: "No se pudo copiar", body: "Selecciona el texto y cópialo a mano.", tone: "warning" }));
  };

  const formUrl = `${window.location.origin}/reservar`;
  const embed = `<iframe src="${formUrl}" style="width:100%;max-width:560px;height:900px;border:0" title="Reservar"></iframe>`;

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="mb-1 font-semibold">Formulario de reservas para tu web</h2>
        <p className="mb-4 text-sm text-slate-500">
          Los huéspedes eligen fechas, ven los tipos de habitación libres con precio y envían su solicitud. Te llega al momento como reserva
          pendiente (canal «Web del hotel») para que la aceptes y le asignes habitación.
        </p>
        <div className="grid gap-3 lg:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-medium text-slate-600">Enlace (para WhatsApp, Instagram, Google Maps…)</p>
            <div className="flex gap-2">
              <Input readOnly value={formUrl} onFocus={(e) => e.target.select()} />
              <Button variant="secondary" onClick={() => copy(formUrl)}><Copy className="h-4 w-4" /></Button>
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-slate-600">Código para insertarlo en la web del hotel</p>
            <div className="flex gap-2">
              <Input readOnly value={embed} onFocus={(e) => e.target.select()} className="font-mono text-xs" />
              <Button variant="secondary" onClick={() => copy(embed)}><Copy className="h-4 w-4" /></Button>
            </div>
          </div>
        </div>
        <a href="/reservar" target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-medium text-brand-700 hover:underline">Ver el formulario →</a>
      </Card>

      <Card>
        <h2 className="mb-1 font-semibold">Canales de venta</h2>
        <p className="mb-4 text-sm text-slate-500">Si activas “auto-confirmar”, las reservas de ese canal entran confirmadas; si no, quedan pendientes de que un responsable las acepte.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {sources.map((s) => (
            <div key={s.id} className="flex items-center gap-3 rounded-lg p-3 ring-1 ring-slate-200">
              <input type="color" value={s.color} onChange={(e) => updateSource(s.id, { color: e.target.value })} className="h-8 w-8 cursor-pointer rounded" aria-label="Color" />
              <div className="flex-1">
                <p className="text-sm font-medium">{s.name}</p>
                <label className="flex items-center gap-1.5 text-xs text-slate-600">
                  <input type="checkbox" checked={s.auto_confirm} onChange={(e) => updateSource(s.id, { auto_confirm: e.target.checked })} className="accent-brand-700" />
                  Auto-confirmar
                </label>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 font-semibold">Importar calendarios (iCal)</h2>
        <p className="mb-4 text-sm text-slate-500">
          En Booking (Extranet → Tarifas y disponibilidad → Sincronizar calendarios) y Airbnb (Calendario → Disponibilidad → Conectar calendarios)
          copia el enlace “Exportar calendario” de cada habitación y pégalo aquí.
        </p>
        <form onSubmit={addFeed} className="mb-4 grid gap-2 sm:grid-cols-[120px_160px_1fr_auto]">
          <Select required value={form.room_id} onChange={(e) => setForm({ ...form, room_id: e.target.value })}>
            <option value="">Hab.</option>
            {rooms.map((r) => <option key={r.id} value={r.id}>{r.number}</option>)}
          </Select>
          <Select required value={form.source_id} onChange={(e) => setForm({ ...form, source_id: e.target.value })}>
            <option value="">Canal</option>
            {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Input required type="url" placeholder="https://admin.booking.com/hotel/hoteladmin/ical.html?t=…" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
          <Button type="submit"><Plus className="h-4 w-4" /> Añadir</Button>
        </form>
        <ul className="divide-y divide-slate-100">
          {feeds.map((f) => (
            <li key={f.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="w-12 font-semibold">{roomById.get(f.room_id)?.number}</span>
              <Badge className="bg-slate-100 text-slate-700 ring-slate-200">{sourceById.get(f.source_id)?.name}</Badge>
              <span className="min-w-0 flex-1 truncate text-slate-500">{f.url}</span>
              <span className={cx("text-xs", f.last_error ? "text-rose-600" : "text-slate-500")}>
                {f.last_error ? `Error: ${f.last_error}` : f.last_synced_at ? `Sync ${fmtDateTime(f.last_synced_at)}` : "Nunca sincronizado"}
              </span>
              <button onClick={() => removeFeed(f.id)} className="text-slate-400 hover:text-rose-600" aria-label="Eliminar"><Trash2 className="h-4 w-4" /></button>
            </li>
          ))}
          {feeds.length === 0 && <li className="py-2 text-sm text-slate-500">Todavía no hay calendarios conectados.</li>}
        </ul>
      </Card>

      <Card>
        <h2 className="mb-1 font-semibold">Exportar disponibilidad a los canales</h2>
        <p className="mb-4 text-sm text-slate-500">
          Pega este enlace en Booking/Airbnb (“Importar calendario”) para que bloqueen las fechas que ya están vendidas aquí y evitar overbooking.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {rooms.map((r) => (
            <button key={r.id} onClick={() => copy(exportUrl(r))} className="flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm ring-1 ring-slate-200 hover:bg-slate-50">
              <span>Habitación <b>{r.number}</b></span>
              <Copy className="h-4 w-4 text-slate-400" />
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Checklists() {
  const toast = useToast();
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [editing, setEditing] = useState<{ id?: string; name: string; order_type: WorkOrderType; text: string } | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("checklist_templates").select("*").order("created_at");
    setTemplates((data ?? []) as ChecklistTemplate[]);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const items = editing.text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((label, i) => ({ key: `i${i}_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 20)}`, label }));
    const payload = { name: editing.name, order_type: editing.order_type, items };
    const { error } = editing.id
      ? await supabase.from("checklist_templates").update(payload).eq("id", editing.id)
      : await supabase.from("checklist_templates").insert(payload);
    if (error) toast({ title: "Error", body: error.message, tone: "error" });
    else {
      setEditing(null);
      load();
    }
  };

  const remove = async (id: string) => {
    if (!confirm("¿Eliminar esta plantilla?")) return;
    await supabase.from("checklist_templates").delete().eq("id", id);
    load();
  };

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">Plantillas de checklist</h2>
        <Button onClick={() => setEditing({ name: "", order_type: "checkout_clean", text: "" })}><Plus className="h-4 w-4" /> Nueva</Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {templates.map((t) => (
          <div key={t.id} className="rounded-lg p-4 ring-1 ring-slate-200">
            <div className="mb-2 flex items-start justify-between">
              <div>
                <p className="font-medium">{t.name}</p>
                <p className="text-xs text-slate-500">{orderTypeLabel[t.order_type]} · {t.items.length} puntos</p>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" className="px-2 py-1" onClick={() => setEditing({ id: t.id, name: t.name, order_type: t.order_type, text: t.items.map((i) => i.label).join("\n") })}>Editar</Button>
                <button onClick={() => remove(t.id)} className="px-2 text-slate-400 hover:text-rose-600" aria-label="Eliminar"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
            <ul className="list-inside list-disc text-sm text-slate-600">
              {t.items.slice(0, 5).map((i) => <li key={i.key}>{i.label}</li>)}
              {t.items.length > 5 && <li className="list-none text-xs text-slate-400">+{t.items.length - 5} más</li>}
            </ul>
          </div>
        ))}
      </div>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "Editar plantilla" : "Nueva plantilla"}>
        {editing && (
          <form onSubmit={save} className="space-y-3">
            <Field label="Nombre"><Input required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="Tipo de orden">
              <Select value={editing.order_type} onChange={(e) => setEditing({ ...editing, order_type: e.target.value as WorkOrderType })}>
                {(Object.keys(orderTypeLabel) as WorkOrderType[]).map((t) => <option key={t} value={t}>{orderTypeLabel[t]}</option>)}
              </Select>
            </Field>
            <Field label="Puntos del checklist" hint="Uno por línea">
              <Textarea rows={10} value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
            </Field>
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button><Button type="submit">Guardar</Button></div>
          </form>
        )}
      </Modal>
    </Card>
  );
}

function RoomsAdmin() {
  const { rooms, reload } = useHotel();
  const toast = useToast();
  const [editing, setEditing] = useState<Partial<Room> | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const payload = {
      number: editing.number, name: editing.name || null, room_type: editing.room_type,
      floor: editing.floor, capacity: editing.capacity, base_price: editing.base_price ?? 80, notes: editing.notes || null, active: editing.active ?? true,
    };
    const { error } = editing.id
      ? await supabase.from("rooms").update(payload).eq("id", editing.id)
      : await supabase.from("rooms").insert(payload);
    if (error) toast({ title: "Error", body: error.message, tone: "error" });
    else {
      setEditing(null);
      reload();
    }
  };

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">Habitaciones ({rooms.filter((r) => r.active).length} activas)</h2>
        <Button onClick={() => setEditing({ room_type: "Doble", floor: 1, capacity: 2, base_price: 85, active: true })}><Plus className="h-4 w-4" /> Nueva</Button>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-500">
          <tr><th className="pb-2 font-medium">Nº</th><th className="pb-2 font-medium">Tipo</th><th className="pb-2 font-medium">Planta</th><th className="pb-2 font-medium">Capacidad</th><th className="pb-2 font-medium">Precio/noche</th><th className="pb-2 font-medium">Activa</th><th /></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rooms.map((r) => (
            <tr key={r.id} className={cx(!r.active && "text-slate-400")}>
              <td className="py-2 font-semibold">{r.number}</td>
              <td className="py-2">{r.room_type}</td>
              <td className="py-2">{r.floor}</td>
              <td className="py-2">{r.capacity}</td>
              <td className="py-2">{r.base_price != null ? `${Math.round(r.base_price)} €` : "—"}</td>
              <td className="py-2">{r.active ? "Sí" : "No"}</td>
              <td className="py-2 text-right"><Button variant="ghost" className="px-2 py-1" onClick={() => setEditing(r)}>Editar</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? `Habitación ${editing.number}` : "Nueva habitación"}>
        {editing && (
          <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
            <Field label="Número"><Input required value={editing.number ?? ""} onChange={(e) => setEditing({ ...editing, number: e.target.value })} /></Field>
            <Field label="Tipo"><Input required value={editing.room_type ?? ""} onChange={(e) => setEditing({ ...editing, room_type: e.target.value })} /></Field>
            <Field label="Planta"><Input type="number" value={editing.floor ?? 1} onChange={(e) => setEditing({ ...editing, floor: Number(e.target.value) })} /></Field>
            <Field label="Capacidad"><Input type="number" min={1} value={editing.capacity ?? 2} onChange={(e) => setEditing({ ...editing, capacity: Number(e.target.value) })} /></Field>
            <Field label="Precio orientativo por noche (€)" hint="Se muestra en el formulario de reservas de la web">
              <Input type="number" min={0} step="1" value={editing.base_price ?? 80} onChange={(e) => setEditing({ ...editing, base_price: Number(e.target.value) })} />
            </Field>
            <div className="sm:col-span-2"><Field label="Notas internas"><Textarea rows={2} value={editing.notes ?? ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field></div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={editing.active ?? true} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} className="accent-brand-700" /> Activa (se puede vender)
            </label>
            <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button><Button type="submit">Guardar</Button></div>
          </form>
        )}
      </Modal>
    </Card>
  );
}
