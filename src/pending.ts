import { brPhoneKey } from './tasks';
import type { Intent, Designated } from './types';

export type PendingAction =
  | { kind: 'ferias_on' }
  | { kind: 'ferias_off' }
  | { kind: 'letter'; para_person_id: string; texto: string }
  | { kind: 'command'; intent: Intent }
  | { kind: 'super_mark'; stage: 1 | 2; data: string; task_id: string; person_id: string; from: Designated['status']; to: 'done' | 'late' | 'missed' };

const TTL_MS = 60_000;
const store = new Map<string, { action: PendingAction; expiresAt: number }>();

export function setPending(phone: string, action: PendingAction): void {
  store.set(brPhoneKey(phone), { action, expiresAt: Date.now() + TTL_MS });
}

export function getPending(phone: string): PendingAction | null {
  const key = brPhoneKey(phone);
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.action;
}

export function clearPending(phone: string): void {
  store.delete(brPhoneKey(phone));
}
