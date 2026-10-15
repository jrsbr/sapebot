import { normalizeText } from './parser';
import { extractFlags, tokenizeAdmin } from './adminparser';
import type { FlagSpec, Person, XEntry } from './types';

export const X_THRESHOLD = 3;
export const DEFAULT_X_CAUSE = 'sem causa informada';

export type XParseError = 'unknown_sub' | 'missing_reason' | 'missing_target' | 'invalid_count' | 'zero_count' | 'bad_syntax';

export type XCommand =
  | { sub: 'perdao'; motivo: string }
  | { sub: 'lista' }
  | { sub: 'tabela' }
  | { sub: 'add'; pessoa: string; n: number; causa: string }
  | { sub: 'remove'; pessoa: string; n: number };

const X_FLAGS: FlagSpec = {
  '-p': { kind: 'value' },
  '-m': { kind: 'value' },
};

const ADD_WORDS = ['add', 'dar', 'adicionar'];
const REMOVE_WORDS = ['remove', 'remover', 'tirar'];

export function isAdminXSub(sub: string): boolean {
  const s = normalizeText(sub);
  return ADD_WORDS.includes(s) || REMOVE_WORDS.includes(s);
}

export function parseXCommand(raw: string): XCommand | { error: XParseError } {
  const tokenized = tokenizeAdmin(raw);
  if ('error' in tokenized) return { error: 'bad_syntax' };
  const { tokens } = tokenized;
  const sub = normalizeText(tokens[1] ?? '');

  if (sub === 'lista') return { sub: 'lista' };
  if (sub === 'tabela') return { sub: 'tabela' };

  if (sub === 'perdao') {
    const motivo = raw.trim().replace(/^\S+\s+\S+\s*/, '').trim();
    if (!motivo) return { error: 'missing_reason' };
    return { sub: 'perdao', motivo };
  }

  const isAdd = ADD_WORDS.includes(sub);
  if (!isAdd && !REMOVE_WORDS.includes(sub)) return { error: 'unknown_sub' };

  const result = extractFlags(tokens.slice(2), X_FLAGS);
  if ('error' in result) return { error: 'bad_syntax' };
  const { positionals, flags } = result;

  const pessoa = flags.get('-p');
  if (typeof pessoa !== 'string') return { error: 'missing_target' };

  let n = 1;
  if (positionals.length > 1) return { error: 'invalid_count' };
  if (positionals.length === 1) {
    if (!/^\d+$/.test(positionals[0])) return { error: 'invalid_count' };
    n = parseInt(positionals[0], 10);
    if (n === 0) return { error: 'zero_count' };
  }

  if (isAdd) {
    const causaValue = flags.get('-m');
    const causa = typeof causaValue === 'string' && causaValue.trim() ? causaValue.trim() : DEFAULT_X_CAUSE;
    return { sub: 'add', pessoa, n, causa };
  }
  return { sub: 'remove', pessoa, n };
}

export function activeXs(xs: XEntry[], personId: string): XEntry[] {
  return xs
    .filter((x) => x.person_id === personId && x.removida_em === '')
    .sort((a, b) => a.criada_em.localeCompare(b.criada_em) || a.__row - b.__row);
}

export function oldestActive(xs: XEntry[], personId: string, n: number): XEntry[] {
  return activeXs(xs, personId).slice(0, n);
}

export function countByPerson(xs: XEntry[], people: Person[]): { person: Person; count: number }[] {
  return people
    .filter((p) => p.ativo)
    .map((person) => ({ person, count: activeXs(xs, person.person_id).length }))
    .sort((a, b) => b.count - a.count || a.person.nome.localeCompare(b.person.nome));
}

export function reachedThreshold(after: number, threshold: number = X_THRESHOLD): boolean {
  return after >= threshold;
}
