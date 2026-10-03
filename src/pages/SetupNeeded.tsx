export default function SetupNeeded() {
  return (
    <div className="mx-auto max-w-xl p-8">
      <h1 className="mb-3 text-2xl font-bold">Configura Supabase</h1>
      <p className="mb-4 text-slate-600">
        Falta conectar la app con tu proyecto de Supabase. Copia <code>.env.example</code> a <code>.env</code> y rellena:
      </p>
      <pre className="rounded-lg bg-slate-900 p-4 text-sm text-slate-100">
{`VITE_SUPABASE_URL=https://<tu-proyecto>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>`}
      </pre>
      <p className="mt-4 text-sm text-slate-500">Consulta el README para los pasos completos (migraciones, funciones y primer usuario).</p>
    </div>
  );
}
