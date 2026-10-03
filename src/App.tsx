import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import { isConfigured } from "./lib/supabase";
import { Spinner } from "./components/ui";
import CleanerLayout from "./components/CleanerLayout";
import Login from "./pages/Login";
import SetupNeeded from "./pages/SetupNeeded";
import BookingRequest from "./pages/public/BookingRequest";
import MyDay from "./pages/cleaner/MyDay";
import OrderDetail from "./pages/cleaner/OrderDetail";

// El panel de responsables se carga bajo demanda: el móvil de las limpiadoras no lo descarga
const ManagerLayout = lazy(() => import("./components/ManagerLayout"));
const Dashboard = lazy(() => import("./pages/manager/Dashboard"));
const CalendarPage = lazy(() => import("./pages/manager/Calendar"));
const Reservations = lazy(() => import("./pages/manager/Reservations"));
const Rooms = lazy(() => import("./pages/manager/Rooms"));
const WorkOrders = lazy(() => import("./pages/manager/WorkOrders"));
const SettingsPage = lazy(() => import("./pages/manager/Settings"));

export default function App() {
  const { session, profile, loading, signOut } = useAuth();
  const location = useLocation();

  if (!isConfigured) return <SetupNeeded />;
  // Formulario público para huéspedes: accesible sin iniciar sesión
  if (location.pathname.startsWith("/reservar")) return <BookingRequest />;
  if (loading) return <Spinner className="h-full" />;
  if (!session) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }
  if (!profile || !profile.active) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-slate-600">Tu usuario no tiene acceso activo. Contacta con un responsable del hotel.</p>
        <button className="text-brand-700 underline" onClick={signOut}>Cerrar sesión</button>
      </div>
    );
  }

  if (profile.role === "manager") {
    return (
      <Suspense fallback={<Spinner className="h-full" />}>
      <Routes>
        <Route element={<ManagerLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="calendario" element={<CalendarPage />} />
          <Route path="reservas" element={<Reservations />} />
          <Route path="habitaciones" element={<Rooms />} />
          <Route path="ordenes" element={<WorkOrders />} />
          <Route path="ajustes" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      </Suspense>
    );
  }

  return (
    <Routes>
      <Route element={<CleanerLayout />}>
        <Route index element={<MyDay />} />
        <Route path="orden/:id" element={<OrderDetail />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
