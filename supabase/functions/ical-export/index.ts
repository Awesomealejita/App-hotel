// Exporta las reservas de una habitación en formato iCal para que
// Booking/Airbnb/Expedia bloqueen esas fechas (evita overbooking entre canales).
// URL: /functions/v1/ical-export?room=<room_id>&token=<rooms.ical_token>
import { adminClient } from "../_shared/auth.ts";
import { buildIcal } from "../_shared/ical.ts";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const roomId = url.searchParams.get("room");
  const token = url.searchParams.get("token");
  if (!roomId || !token) return new Response("Missing params", { status: 400 });

  const admin = adminClient();
  const { data: room } = await admin
    .from("rooms")
    .select("id, number, ical_token")
    .eq("id", roomId)
    .single();
  if (!room || room.ical_token !== token) return new Response("Not found", { status: 404 });

  const today = new Date().toISOString().slice(0, 10);
  const { data: reservations } = await admin
    .from("reservations")
    .select("id, check_in, check_out")
    .eq("room_id", roomId)
    .in("status", ["confirmed", "checked_in"])
    .gte("check_out", today);

  const ics = buildIcal(
    `Habitación ${room.number}`,
    (reservations ?? []).map((r) => ({
      uid: `${r.id}@app-hotel`,
      start: r.check_in,
      end: r.check_out,
      summary: "No disponible",
    })),
  );
  return new Response(ics, {
    headers: { "Content-Type": "text/calendar; charset=utf-8" },
  });
});
