import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import type { BookingSource, Profile, Room } from "./types";
import { useRealtime } from "./useRealtime";

/** Datos maestros pequeños que usan casi todas las pantallas. */
export function useLookups() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [staff, setStaff] = useState<Profile[]>([]);
  const [sources, setSources] = useState<BookingSource[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [r, p, s] = await Promise.all([
      supabase.from("rooms").select("*").order("number"),
      supabase.from("profiles").select("*").order("full_name"),
      supabase.from("booking_sources").select("*").order("name"),
    ]);
    setRooms((r.data ?? []) as Room[]);
    setStaff((p.data ?? []) as Profile[]);
    setSources((s.data ?? []) as BookingSource[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useRealtime(["rooms"], (_t, payload) => {
    if (payload.eventType === "UPDATE") {
      const row = payload.new as unknown as Room;
      setRooms((prev) => prev.map((r) => (r.id === row.id ? row : r)));
    } else {
      load();
    }
  });

  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);
  const staffById = useMemo(() => new Map(staff.map((p) => [p.id, p])), [staff]);
  const sourceById = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);
  const cleaners = useMemo(() => staff.filter((p) => p.role === "cleaner" && p.active), [staff]);

  return { rooms, staff, cleaners, sources, roomById, staffById, sourceById, loading, reload: load };
}

export type Lookups = ReturnType<typeof useLookups>;
