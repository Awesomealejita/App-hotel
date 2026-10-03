// Alta de personal (limpiadoras o responsables) por parte de un responsable.
import { corsHeaders, json } from "../_shared/cors.ts";
import { adminClient, requireManager } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = adminClient();
  if (!(await requireManager(req, admin))) return json({ error: "No autorizado" }, 401);

  const { email, password, full_name, role = "cleaner", phone } = await req.json();
  if (!email || !password || password.length < 8) {
    return json({ error: "Email y contraseña (mín. 8 caracteres) obligatorios" }, 400);
  }
  if (!["cleaner", "manager"].includes(role)) return json({ error: "Rol no válido" }, 400);

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, role },
  });
  if (error) return json({ error: error.message }, 400);

  if (phone) await admin.from("profiles").update({ phone }).eq("id", data.user.id);
  return json({ id: data.user.id });
});
