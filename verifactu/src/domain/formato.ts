// Utilidades de formato que deben coincidir exactamente entre la huella y el XML.

/** Convierte un importe a céntimos enteros para no arrastrar errores de coma flotante. */
export function aCentimos(importe: number | string): number {
  const n = typeof importe === 'string' ? Number(importe) : importe;
  if (!Number.isFinite(n)) throw new Error(`Importe no válido: ${importe}`);
  return Math.round(n * 100);
}

/** Céntimos -> "123.45" (punto decimal, dos decimales). */
export function formatoImporte(centimos: number): string {
  const signo = centimos < 0 ? '-' : '';
  const abs = Math.abs(centimos);
  return `${signo}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** "2025-03-07" -> "07-03-2025" (formato de fecha de la AEAT). */
export function fechaAeat(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) throw new Error(`Fecha no válida (se espera AAAA-MM-DD): ${isoDate}`);
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * Fecha y hora con huso horario, p.ej. "2025-03-07T10:15:00+01:00".
 * Se genera en hora peninsular (Europe/Madrid) salvo que se indique otra zona.
 */
export function fechaHoraHuso(fecha: Date = new Date(), timeZone = 'Europe/Madrid'): string {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(fecha)
      .map((p) => [p.type, p.value]),
  );
  const local = Date.UTC(+partes.year, +partes.month - 1, +partes.day, +partes.hour, +partes.minute, +partes.second);
  const offsetMin = Math.round((local - Math.floor(fecha.getTime() / 1000) * 1000) / 60000);
  const signo = offsetMin >= 0 ? '+' : '-';
  const hh = String(Math.floor(Math.abs(offsetMin) / 60)).padStart(2, '0');
  const mm = String(Math.abs(offsetMin) % 60).padStart(2, '0');
  return `${partes.year}-${partes.month}-${partes.day}T${partes.hour}:${partes.minute}:${partes.second}${signo}${hh}:${mm}`;
}
