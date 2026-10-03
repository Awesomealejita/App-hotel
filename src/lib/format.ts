import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { es } from "date-fns/locale";

export const toISODate = (d: Date) => format(d, "yyyy-MM-dd");
export const fmtDate = (iso: string, pattern = "d MMM yyyy") => format(parseISO(iso), pattern, { locale: es });
export const fmtTime = (iso: string) => format(parseISO(iso), "HH:mm", { locale: es });
export const fmtDateTime = (iso: string) => format(parseISO(iso), "d MMM, HH:mm", { locale: es });
export const nights = (checkIn: string, checkOut: string) =>
  differenceInCalendarDays(parseISO(checkOut), parseISO(checkIn));
export const eur = (n: number | null | undefined) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n ?? 0);

export function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
