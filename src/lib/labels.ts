import type { Priority, ReservationStatus, RoomStatus, WorkOrderStatus, WorkOrderType } from "./types";

export const roomStatusLabel: Record<RoomStatus, string> = {
  clean: "Limpia",
  dirty: "Sucia",
  cleaning: "Limpiando",
  inspected: "Revisada",
  out_of_service: "Fuera de servicio",
};

export const roomStatusColor: Record<RoomStatus, string> = {
  clean: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  dirty: "bg-rose-100 text-rose-800 ring-rose-200",
  cleaning: "bg-amber-100 text-amber-800 ring-amber-200",
  inspected: "bg-sky-100 text-sky-800 ring-sky-200",
  out_of_service: "bg-slate-200 text-slate-700 ring-slate-300",
};

export const reservationStatusLabel: Record<ReservationStatus, string> = {
  pending: "Pendiente",
  confirmed: "Confirmada",
  rejected: "Rechazada",
  cancelled: "Cancelada",
  checked_in: "Alojado",
  checked_out: "Salida hecha",
};

export const reservationStatusColor: Record<ReservationStatus, string> = {
  pending: "bg-amber-100 text-amber-800 ring-amber-200",
  confirmed: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  rejected: "bg-rose-100 text-rose-800 ring-rose-200",
  cancelled: "bg-slate-200 text-slate-600 ring-slate-300",
  checked_in: "bg-sky-100 text-sky-800 ring-sky-200",
  checked_out: "bg-violet-100 text-violet-800 ring-violet-200",
};

export const orderTypeLabel: Record<WorkOrderType, string> = {
  checkout_clean: "Limpieza de salida",
  stayover: "Repaso cliente alojado",
  deep_clean: "Limpieza a fondo",
  maintenance: "Mantenimiento",
  inspection: "Revisión",
};

export const orderStatusLabel: Record<WorkOrderStatus, string> = {
  pending: "Pendiente",
  in_progress: "En curso",
  done: "Terminada",
  verified: "Verificada",
  issue: "Incidencia",
};

export const orderStatusColor: Record<WorkOrderStatus, string> = {
  pending: "bg-slate-100 text-slate-700 ring-slate-200",
  in_progress: "bg-amber-100 text-amber-800 ring-amber-200",
  done: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  verified: "bg-sky-100 text-sky-800 ring-sky-200",
  issue: "bg-rose-100 text-rose-800 ring-rose-200",
};

export const priorityLabel: Record<Priority, string> = {
  low: "Baja",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente",
};

export const priorityColor: Record<Priority, string> = {
  low: "text-slate-500",
  normal: "text-slate-700",
  high: "text-orange-600",
  urgent: "text-rose-600 font-semibold",
};
