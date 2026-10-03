import { supabase } from "./supabase";
import type { Room } from "./types";

export async function syncIcal() {
  const { data, error } = await supabase.functions.invoke("sync-ical", { body: {} });
  if (error) throw error;
  return data as { ok: boolean; feeds: { source: string; created?: number; updated?: number; cancelled?: number; error?: string }[] };
}

export async function availableRooms(from: string, to: string, excludeReservation?: string) {
  const { data, error } = await supabase.rpc("available_rooms", {
    p_from: from,
    p_to: to,
    p_exclude_reservation: excludeReservation ?? null,
  });
  if (error) throw error;
  return (data ?? []) as Room[];
}

export async function decideReservation(id: string, accept: boolean, roomId?: string | null) {
  const { error } = await supabase.rpc("decide_reservation", { p_id: id, p_accept: accept, p_room_id: roomId ?? null });
  if (error) throw error;
}

export async function photoUrl(path: string) {
  const { data } = await supabase.storage.from("work-order-photos").createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}
