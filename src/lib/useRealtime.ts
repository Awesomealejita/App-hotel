import { useEffect, useRef } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "./supabase";

type Table = "rooms" | "reservations" | "work_orders" | "work_order_notes";

/**
 * Se suscribe a los cambios (INSERT/UPDATE/DELETE) de una o varias tablas.
 * RLS se aplica también en Realtime: cada usuario solo recibe lo que puede ver.
 */
export function useRealtime(
  tables: Table[],
  onChange: (table: Table, payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void,
  filter?: string,
) {
  const cb = useRef(onChange);
  cb.current = onChange;
  const key = tables.join(",") + (filter ?? "");

  useEffect(() => {
    const channel = supabase.channel(`rt:${key}:${Math.random().toString(36).slice(2)}`);
    for (const table of tables) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, ...(filter ? { filter } : {}) },
        (payload) => cb.current(table, payload),
      );
    }
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
