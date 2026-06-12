// Utilidades de data e fuso horário sem dependências externas (usa a API Intl).

export function nowIso(): string {
  return new Date().toISOString();
}

// Retorna a data local "YYYY-MM-DD" para um fuso IANA (ex.: America/Sao_Paulo).
export function localDate(tz: string, date: Date = new Date()): string {
  // 'en-CA' formata como YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

// Converte um timestamp ISO para a data local "YYYY-MM-DD" no fuso informado.
export function isoToLocalDate(iso: string, tz: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return localDate(tz, d);
}

// Diferença em dias inteiros entre duas datas no formato "YYYY-MM-DD".
export function daysBetween(fromYmd: string, toYmd: string): number {
  const a = Date.parse(`${fromYmd}T00:00:00Z`);
  const b = Date.parse(`${toYmd}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function logicalDate(
  tz: string,
  date: Date = new Date(),
  shift = 3,
): string {
  const shifted = new Date(date.getTime() - shift * 60 * 60 * 1000);
  return localDate(tz, shifted);
}

export function addDays(
  ymd: string, 
  days: number,
): string {
  const d = new Date(`${ymd}T12:00:00Z`);     
  d.setUTCDate(d.getUTCDate() + days);      
  return d.toISOString().slice(0, 10);   
}

export function weekdayName(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' }).format(d);
}

export function localHour(tz: string, date: Date = new Date()): number {
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(date);
  return parseInt(s, 10);
}