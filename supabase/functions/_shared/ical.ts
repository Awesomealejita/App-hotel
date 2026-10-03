export interface IcalEvent {
  uid: string;
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD (exclusivo, = día de salida)
  summary: string;
  description: string;
}

function toIsoDate(value: string): string {
  // 20261003 | 20261003T140000Z
  const v = value.trim();
  return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
}

function unescape(v: string) {
  return v.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\;/g, ";").replace(/\\\\/g, "\\");
}

/** Parser iCal mínimo, suficiente para los feeds de Booking, Airbnb, Expedia, Vrbo… */
export function parseIcal(text: string): IcalEvent[] {
  // RFC 5545: las líneas que empiezan por espacio/tab continúan la anterior
  const lines = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const events: IcalEvent[] = [];
  let cur: Partial<IcalEvent> | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      cur = { summary: "", description: "" };
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur?.uid && cur.start && cur.end) events.push(cur as IcalEvent);
      cur = null;
      continue;
    }
    if (!cur) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).split(";")[0].toUpperCase();
    const value = line.slice(idx + 1);
    switch (key) {
      case "UID": cur.uid = value.trim(); break;
      case "DTSTART": cur.start = toIsoDate(value); break;
      case "DTEND": cur.end = toIsoDate(value); break;
      case "SUMMARY": cur.summary = unescape(value); break;
      case "DESCRIPTION": cur.description = unescape(value); break;
    }
  }
  return events.filter((e) => e.end > e.start);
}

function icalDate(d: string) {
  return d.replaceAll("-", "");
}

export function buildIcal(
  calName: string,
  events: { uid: string; start: string; end: string; summary: string }[],
): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const body = events.map((e) => [
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${icalDate(e.start)}`,
    `DTEND;VALUE=DATE:${icalDate(e.end)}`,
    `SUMMARY:${e.summary}`,
    "END:VEVENT",
  ].join("\r\n"));
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//App Hotel//PMS//ES",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${calName}`,
    ...body,
    "END:VCALENDAR",
  ].join("\r\n");
}
