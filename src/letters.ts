import { normalizeText } from './parser';
import { damerauLevenshtein } from './tasks';
import { localDate, localMinuteOfDay, addDays } from './time';
import type { Person, Letter } from './types';

export const LETTER_MAX_CHARS = 500;
export const LETTER_READ_RETENTION_DAYS = 7;
export const LETTER_UNREAD_RETENTION_DAYS = 30;

export type RecipientResolution =
  | { kind: 'exact'; person: Person }
  | { kind: 'fuzzy'; person: Person }
  | { kind: 'ambiguous'; candidates: Person[] }
  | { kind: 'none' };

export function resolveRecipient(
  people: Person[],
  senderId: string,
  query: string,
): RecipientResolution {
  const q = normalizeText(query);
  if (!q) return { kind: 'none' };
  const pool = people.filter((p) => p.ativo && p.opt_in && p.person_id !== senderId);

  const exact = pool.filter(
    (p) => normalizeText(p.nome) === q || normalizeText(p.person_id) === q,
  );
  if (exact.length === 1) return { kind: 'exact', person: exact[0] };
  if (exact.length > 1) return { kind: 'ambiguous', candidates: exact };

  const ranked: { person: Person; rank: number; name: string }[] = [];
  for (const p of pool) {
    const name = normalizeText(p.nome);
    if (!name) continue;
    const isPrefix = q.length >= 2 && q !== name && name.startsWith(q);
    const dist = damerauLevenshtein(q, name);
    const maxDist = name.length <= 2 ? 0 : name.length <= 5 ? 1 : 2;
    if (isPrefix || dist <= maxDist) {
      ranked.push({ person: p, rank: isPrefix ? 0 : dist, name });
    }
  }
  if (ranked.length === 0) return { kind: 'none' };
  ranked.sort(
    (a, b) =>
      a.rank - b.rank ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
      (a.person.person_id < b.person.person_id ? -1 : a.person.person_id > b.person.person_id ? 1 : 0),
  );
  const best = ranked[0].rank;
  const tied = ranked.filter((r) => r.rank === best);
  if (tied.length === 1) return { kind: 'fuzzy', person: tied[0].person };
  return { kind: 'ambiguous', candidates: tied.map((r) => r.person) };
}

export interface DeliveryClock {
  tz: string;
  hour: number;
  minute: number;
}

export function deliveryDate(createdIso: string, clock: DeliveryClock): string | null {
  const created = new Date(createdIso);
  if (Number.isNaN(created.getTime())) return null;
  const d = localDate(clock.tz, created);
  const mins = localMinuteOfDay(clock.tz, created);
  return mins < clock.hour * 60 + clock.minute ? d : addDays(d, 1);
}

export function isDelivered(letter: Letter, now: Date, clock: DeliveryClock): boolean {
  const dd = deliveryDate(letter.criada_em, clock);
  if (dd === null) return false;
  const today = localDate(clock.tz, now);
  const mins = localMinuteOfDay(clock.tz, now);
  return dd < today || (dd === today && mins >= clock.hour * 60 + clock.minute);
}

export function unreadDelivered(
  letters: Letter[],
  personId: string,
  now: Date,
  clock: DeliveryClock,
): Letter[] {
  return letters
    .filter((l) => l.para_person_id === personId && l.lida_em === '' && isDelivered(l, now, clock))
    .sort(
      (a, b) =>
        (a.criada_em < b.criada_em ? -1 : a.criada_em > b.criada_em ? 1 : 0) ||
        (a.letter_id < b.letter_id ? -1 : a.letter_id > b.letter_id ? 1 : 0),
    );
}

export function deliveryDayLabel(now: Date, clock: DeliveryClock): 'hoje' | 'amanhã' {
  return deliveryDate(now.toISOString(), clock) === localDate(clock.tz, now) ? 'hoje' : 'amanhã';
}

export function lettersToPurge(
  letters: Letter[],
  now: Date,
  readDays = LETTER_READ_RETENTION_DAYS,
  unreadDays = LETTER_UNREAD_RETENTION_DAYS,
): Letter[] {
  return letters.filter((l) => {
    const read = l.lida_em !== '';
    const t = Date.parse(read ? l.lida_em : l.criada_em);
    if (Number.isNaN(t)) return false;
    return now.getTime() - t > (read ? readDays : unreadDays) * 86_400_000;
  });
}
