// Importa las reservas de los canales externos (Booking, Airbnb, Expedia…)
// a partir de los feeds iCal configurados por habitación.
//
// Invocación:
//  - Desde la app (botón "Sincronizar"): con el JWT de un responsable.
//  - Programada con pg_cron + pg_net: con la cabecera x-cron-secret = CRON_SECRET.
import { corsHeaders, json } from "../_shared/cors.ts";
import { adminClient, requireManager } from "../_shared/auth.ts";
import { parseIcal } from "../_shared/ical.ts";

const OWN_UID_SUFFIX = "@app-hotel"; // eventos que exportamos nosotros: no reimportar

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = adminClient();
  const cronSecret = Deno.env.get("CRON_SECRET");
  const isCron = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
  if (!isCron && !(await requireManager(req, admin))) {
    return json({ error: "No autorizado" }, 401);
  }

  const { data: feeds, error } = await admin
    .from("ical_feeds")
    .select("id, url, room_id, source_id, booking_sources(name, auto_confirm)")
    .eq("active", true);
  if (error) return json({ error: error.message }, 500);

  const today = new Date().toISOString().slice(0, 10);
  const summary: Record<string, unknown>[] = [];

  for (const feed of feeds ?? []) {
    const source = feed.booking_sources as unknown as { name: string; auto_confirm: boolean };
    try {
      const resp = await fetch(feed.url, { headers: { "User-Agent": "AppHotel-PMS/1.0" } });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const events = parseIcal(await resp.text()).filter(
        (e) => !e.uid.endsWith(OWN_UID_SUFFIX) && e.end >= today,
      );

      const { data: existing } = await admin
        .from("reservations")
        .select("id, external_uid, status")
        .eq("source_id", feed.source_id)
        .eq("room_id", feed.room_id)
        .gte("check_out", today);
      const byUid = new Map((existing ?? []).map((r) => [r.external_uid, r]));

      let created = 0, updated = 0, cancelled = 0;
      for (const ev of events) {
        const guestName = ev.summary && !/not available|closed|reserved|blocked/i.test(ev.summary)
          ? ev.summary
          : `Reserva ${source.name}`;
        const prev = byUid.get(ev.uid);
        if (prev) {
          byUid.delete(ev.uid);
          await admin.from("reservations")
            .update({ check_in: ev.start, check_out: ev.end, notes: ev.description || null })
            .eq("id", prev.id);
          updated++;
        } else {
          const { error: insErr } = await admin.from("reservations").insert({
            room_id: feed.room_id,
            source_id: feed.source_id,
            external_uid: ev.uid,
            guest_name: guestName,
            check_in: ev.start,
            check_out: ev.end,
            notes: ev.description || null,
            status: source.auto_confirm ? "confirmed" : "pending",
          });
          // Si choca con otra reserva confirmada, la dejamos pendiente para que decida un responsable
          if (insErr?.code === "23P01") {
            await admin.from("reservations").insert({
              room_id: feed.room_id, source_id: feed.source_id, external_uid: ev.uid,
              guest_name: guestName, check_in: ev.start, check_out: ev.end,
              notes: `⚠️ Solapa con otra reserva. ${ev.description ?? ""}`.trim(),
              status: "pending",
            });
          } else if (insErr) {
            throw insErr;
          }
          created++;
        }
      }

      // Lo que ya no aparece en el feed se ha cancelado en el canal
      for (const gone of byUid.values()) {
        if (gone.status === "pending" || gone.status === "confirmed") {
          await admin.from("reservations").update({ status: "cancelled" }).eq("id", gone.id);
          cancelled++;
        }
      }

      await admin.from("ical_feeds")
        .update({ last_synced_at: new Date().toISOString(), last_error: null })
        .eq("id", feed.id);
      summary.push({ feed: feed.id, source: source.name, created, updated, cancelled });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await admin.from("ical_feeds").update({ last_error: message }).eq("id", feed.id);
      summary.push({ feed: feed.id, source: source.name, error: message });
    }
  }

  return json({ ok: true, feeds: summary });
});
