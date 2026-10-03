import logo from "../assets/icon.svg";
import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { Button, Field, Input } from "../components/ui";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message === "Invalid login credentials" ? "Email o contraseña incorrectos" : error.message);
    setLoading(false);
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-brand-700 to-brand-800 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex flex-col items-center gap-2 pb-2">
          <img src={logo} className="h-14 w-14" alt="" />
          <h1 className="text-xl font-bold">Hotel PMS</h1>
          <p className="text-sm text-slate-500">Gestión de reservas y limpieza</p>
        </div>
        <Field label="Email">
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Contraseña">
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-700">{error}</p>}
        <Button type="submit" loading={loading} className="w-full py-2.5">Entrar</Button>
      </form>
    </div>
  );
}
