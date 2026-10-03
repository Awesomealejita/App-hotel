import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

/** Devuelve el id del usuario si el JWT pertenece a un responsable activo. */
export async function requireManager(req: Request, admin: SupabaseClient): Promise<string | null> {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return null;
  const { data } = await admin
    .from("profiles")
    .select("role, active")
    .eq("id", user.id)
    .single();
  return data?.role === "manager" && data.active ? user.id : null;
}
