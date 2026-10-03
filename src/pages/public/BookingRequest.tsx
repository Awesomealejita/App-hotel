import { useMemo, useState, type FormEvent } from "react";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { enGB, es } from "date-fns/locale";
import { BedDouble, CalendarDays, Check, ChevronLeft, Users } from "lucide-react";
import logo from "../../assets/icon.svg";
import { supabase } from "../../lib/supabase";
import { errorMessage, toISODate } from "../../lib/format";
import type { PublicAvailability } from "../../lib/types";
import { cx } from "../../components/ui";

const HOTEL_NAME = (import.meta.env.VITE_HOTEL_NAME as string | undefined) || "Hotel";

const t = {
  es: {
    title: "Solicitar reserva", intro: "Elige fechas y te mostramos las habitaciones disponibles. El hotel confirmará tu reserva lo antes posible.",
    checkIn: "Entrada", checkOut: "Salida", guests: "Huéspedes", search: "Ver disponibilidad", nights: (n: number) => `${n} ${n === 1 ? "noche" : "noches"}`,
    available: (n: number) => (n <= 2 ? `¡Solo quedan ${n}!` : `${n} disponibles`), upTo: (n: number) => `hasta ${n} pers.`,
    perNight: "/ noche", total: "Total estimado", choose: "Elegir", none: "No hay habitaciones disponibles para esas fechas y huéspedes. Prueba otras fechas o llámanos.",
    yourData: "Tus datos", name: "Nombre y apellidos", email: "Email", phone: "Teléfono (opcional)", notes: "Peticiones (opcional)",
    notesPh: "Hora de llegada, cuna, cama extra, alergias…", privacy: "Acepto que el hotel use estos datos para gestionar mi reserva.",
    send: "Enviar solicitud", back: "Cambiar habitación", sending: "Enviando…",
    doneTitle: "¡Solicitud enviada!", doneText: "El hotel ya ha recibido tu solicitud. Te confirmaremos la reserva por email o teléfono.",
    ref: "Tu referencia", newReq: "Hacer otra solicitud", noPay: "No se realiza ningún cargo ahora. El precio es orientativo.",
  },
  en: {
    title: "Booking request", intro: "Choose your dates and we'll show you the available rooms. The hotel will confirm your booking as soon as possible.",
    checkIn: "Check-in", checkOut: "Check-out", guests: "Guests", search: "Check availability", nights: (n: number) => `${n} ${n === 1 ? "night" : "nights"}`,
    available: (n: number) => (n <= 2 ? `Only ${n} left!` : `${n} available`), upTo: (n: number) => `up to ${n} guests`,
    perNight: "/ night", total: "Estimated total", choose: "Select", none: "No rooms available for those dates and guests. Try other dates or call us.",
    yourData: "Your details", name: "Full name", email: "Email", phone: "Phone (optional)", notes: "Requests (optional)",
    notesPh: "Arrival time, cot, extra bed, allergies…", privacy: "I agree that the hotel may use this data to manage my booking.",
    send: "Send request", back: "Change room", sending: "Sending…",
    doneTitle: "Request sent!", doneText: "The hotel has received your request. We'll confirm your booking by email or phone.",
    ref: "Your reference", newReq: "Make another request", noPay: "You won't be charged now. The price is an estimate.",
  },
};

const roomTypeNames: Record<string, string> = { Individual: "Single", Doble: "Double", Twin: "Twin", Triple: "Triple", Suite: "Suite" };

/** Formulario público (sin login) para que el huésped solicite una reserva. Se puede incrustar en la web del hotel. */
export default function BookingRequest() {
  const [lang, setLang] = useState<"es" | "en">(() =>
    import.meta.env.MODE === "demo" || navigator.language?.startsWith("es") ? "es" : "en",
  );
  const tr = t[lang];
  const locale = lang === "es" ? es : enGB;
  const today = toISODate(new Date());

  const [checkIn, setCheckIn] = useState(toISODate(addDays(new Date(), 7)));
  const [checkOut, setCheckOut] = useState(toISODate(addDays(new Date(), 9)));
  const [guests, setGuests] = useState(2);
  const [options, setOptions] = useState<PublicAvailability[] | null>(null);
  const [selected, setSelected] = useState<PublicAvailability | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", notes: "", website: "", privacy: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  const n = useMemo(() => Math.max(differenceInCalendarDays(parseISO(checkOut), parseISO(checkIn)), 0), [checkIn, checkOut]);
  const fmt = (d: string) => format(parseISO(d), "EEE d MMM", { locale });
  const typeName = (x: string) => (lang === "en" ? roomTypeNames[x] ?? x : x);

  const search = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSelected(null);
    const { data, error } = await supabase.rpc("public_availability", { p_from: checkIn, p_to: checkOut, p_guests: guests });
    setLoading(false);
    if (error) setError(errorMessage(error));
    else setOptions((data ?? []) as PublicAvailability[]);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.rpc("request_booking", {
      p_check_in: checkIn, p_check_out: checkOut, p_guests: guests, p_room_type: selected.room_type,
      p_name: form.name, p_email: form.email, p_phone: form.phone || null, p_notes: form.notes || null, p_website: form.website || null,
    });
    setLoading(false);
    if (error) setError(errorMessage(error));
    else setReference(data as string);
  };

  const reset = () => {
    setReference(null);
    setOptions(null);
    setSelected(null);
    setForm({ name: "", email: "", phone: "", notes: "", website: "", privacy: false });
  };

  const input = "block w-full rounded-xl border-0 bg-white px-3.5 py-3 text-[15px] ring-1 ring-slate-300 focus:ring-2 focus:ring-brand-600 focus:outline-none";

  return (
    <div className="min-h-full bg-gradient-to-b from-brand-50 to-slate-50 px-4 py-6 sm:py-10">
      <div className="mx-auto max-w-lg">
        <header className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src={logo} className="h-9 w-9" alt="" />
            <div className="leading-tight">
              <p className="font-bold">{HOTEL_NAME}</p>
              <p className="text-xs text-slate-500">{tr.title}</p>
            </div>
          </div>
          <div className="flex rounded-lg bg-white p-0.5 text-xs font-semibold ring-1 ring-slate-200">
            {(["es", "en"] as const).map((l) => (
              <button key={l} onClick={() => setLang(l)} className={cx("rounded-md px-2.5 py-1 uppercase", lang === l ? "bg-brand-700 text-white" : "text-slate-500")}>
                {l}
              </button>
            ))}
          </div>
        </header>

        {reference ? (
          <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <Check className="h-7 w-7" strokeWidth={3} />
            </div>
            <h1 className="text-xl font-bold">{tr.doneTitle}</h1>
            <p className="mt-2 text-sm text-slate-600">{tr.doneText}</p>
            <div className="mt-5 rounded-xl bg-slate-50 p-4">
              <p className="text-xs tracking-wide text-slate-500 uppercase">{tr.ref}</p>
              <p className="mt-1 font-mono text-2xl font-bold tracking-wider select-all">{reference}</p>
              <p className="mt-2 text-sm text-slate-600">
                {selected && typeName(selected.room_type)} · {fmt(checkIn)} → {fmt(checkOut)} · {guests} {tr.guests.toLowerCase()}
              </p>
            </div>
            <button onClick={reset} className="mt-5 text-sm font-medium text-brand-700 hover:underline">{tr.newReq}</button>
          </div>
        ) : (
          <>
            <form onSubmit={search} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
              <p className="mb-4 text-sm text-slate-600">{tr.intro}</p>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600"><CalendarDays className="h-3.5 w-3.5" /> {tr.checkIn}</span>
                  <input id="bk-checkin" type="date" required min={today} value={checkIn} className={input}
                    onChange={(e) => {
                      setCheckIn(e.target.value);
                      if (e.target.value >= checkOut) setCheckOut(toISODate(addDays(parseISO(e.target.value), 1)));
                      setOptions(null);
                    }} />
                </label>
                <label className="block">
                  <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600"><CalendarDays className="h-3.5 w-3.5" /> {tr.checkOut}</span>
                  <input id="bk-checkout" type="date" required min={toISODate(addDays(parseISO(checkIn), 1))} value={checkOut} className={input}
                    onChange={(e) => { setCheckOut(e.target.value); setOptions(null); }} />
                </label>
              </div>
              <div className="mt-3 flex items-end gap-3">
                <label className="block flex-1">
                  <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600"><Users className="h-3.5 w-3.5" /> {tr.guests}</span>
                  <div className="flex items-center rounded-xl ring-1 ring-slate-300">
                    <button type="button" onClick={() => { setGuests(Math.max(1, guests - 1)); setOptions(null); }} className="px-4 py-3 text-lg text-slate-600" aria-label="-">−</button>
                    <span className="flex-1 text-center font-semibold">{guests}</span>
                    <button type="button" onClick={() => { setGuests(Math.min(8, guests + 1)); setOptions(null); }} className="px-4 py-3 text-lg text-slate-600" aria-label="+">+</button>
                  </div>
                </label>
                <button type="submit" disabled={loading || n < 1} className="flex-1 rounded-xl bg-brand-700 px-4 py-3 text-[15px] font-semibold text-white hover:bg-brand-800 disabled:opacity-60">
                  {loading && !options ? tr.sending : tr.search}
                </button>
              </div>
              {n > 0 && <p className="mt-2 text-xs text-slate-500">{tr.nights(n)}</p>}
            </form>

            {error && <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700 ring-1 ring-rose-200">{error}</p>}

            {options && !selected && (
              <div className="mt-4 space-y-3">
                {options.length === 0 && <p className="rounded-xl bg-white p-4 text-sm text-slate-600 ring-1 ring-slate-200">{tr.none}</p>}
                {options.map((o) => (
                  <div key={o.room_type} className="flex items-center gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><BedDouble className="h-6 w-6" /></div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{typeName(o.room_type)}</p>
                      <p className="text-xs text-slate-500">{tr.upTo(o.capacity)} · <span className={cx(o.available <= 2 && "font-medium text-orange-600")}>{tr.available(o.available)}</span></p>
                      <p className="mt-1 text-sm"><b>{Math.round(o.price_per_night)} €</b> <span className="text-slate-500">{tr.perNight}</span> · {Math.round(o.price_per_night * n)} € total</p>
                    </div>
                    <button onClick={() => setSelected(o)} className="rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-800">{tr.choose}</button>
                  </div>
                ))}
              </div>
            )}

            {selected && (
              <form onSubmit={submit} className="mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
                <button type="button" onClick={() => setSelected(null)} className="mb-3 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
                  <ChevronLeft className="h-4 w-4" /> {tr.back}
                </button>
                <div className="mb-4 rounded-xl bg-brand-50 p-3 text-sm">
                  <p className="font-semibold">{typeName(selected.room_type)} · {tr.nights(n)}</p>
                  <p className="text-slate-600">{fmt(checkIn)} → {fmt(checkOut)} · {guests} {tr.guests.toLowerCase()}</p>
                  <p className="mt-1">{tr.total}: <b>{Math.round(selected.price_per_night * n)} €</b></p>
                </div>
                <h2 className="mb-3 font-semibold">{tr.yourData}</h2>
                <div className="space-y-3">
                  <input id="bk-name" required minLength={2} maxLength={100} autoComplete="name" placeholder={tr.name} className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  <input id="bk-email" required type="email" autoComplete="email" placeholder={tr.email} className={input} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  <input id="bk-phone" type="tel" autoComplete="tel" maxLength={30} placeholder={tr.phone} className={input} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                  <textarea id="bk-notes" rows={3} maxLength={1000} placeholder={`${tr.notes}: ${tr.notesPh}`} className={input} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                  {/* Campo trampa para robots: oculto a las personas */}
                  <input tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} name="website" />
                  <label className="flex items-start gap-2.5 text-sm text-slate-600">
                    <input id="bk-privacy" type="checkbox" required checked={form.privacy} onChange={(e) => setForm({ ...form, privacy: e.target.checked })} className="mt-0.5 h-4 w-4 accent-brand-700" />
                    {tr.privacy}
                  </label>
                </div>
                <button type="submit" disabled={loading} className="mt-4 w-full rounded-xl bg-brand-700 py-3.5 text-[15px] font-semibold text-white hover:bg-brand-800 disabled:opacity-60">
                  {loading ? tr.sending : tr.send}
                </button>
                <p className="mt-2 text-center text-xs text-slate-500">{tr.noPay}</p>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
