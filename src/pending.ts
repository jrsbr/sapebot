import { brPhoneKey } from './tasks';
import type { Intent } from './types';

export type PendingAction =
  | { kind: 'ferias_on' }
  | { kind: 'ferias_off' }
  | { kind: 'command'; intent: Intent };

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
