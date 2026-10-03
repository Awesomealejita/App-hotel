import { Link, Outlet } from "react-router-dom";
import { LogOut } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { useLookups } from "../lib/useLookups";

export default function CleanerLayout() {
  const { profile, signOut } = useAuth();
  const lookups = useLookups();
  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col">
      <header className="sticky top-0 z-30 flex items-center justify-between bg-brand-700 px-4 py-3 text-white shadow">
        <Link to="/" className="flex items-center gap-2">
          <img src="/icon.svg" className="h-7 w-7 rounded" alt="" />
          <div className="leading-tight">
            <p className="text-sm font-semibold">Hola, {profile?.full_name?.split(" ")[0]}</p>
            <p className="text-xs text-white/70">Limpieza y habitaciones</p>
          </div>
        </Link>
        <button onClick={signOut} className="rounded-lg p-2 hover:bg-white/10" aria-label="Cerrar sesión">
          <LogOut className="h-5 w-5" />
        </button>
      </header>
      <main className="flex-1 p-4 pb-24">
        <Outlet context={lookups} />
      </main>
    </div>
  );
}
