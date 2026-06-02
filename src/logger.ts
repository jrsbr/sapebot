// Logger simples baseado em console. Nunca registra segredos.
// A função redact mascara chaves sensíveis caso um objeto de metadados as contenha.

type Level = 'debug' | 'info' | 'warn' | 'error';

const SENSITIVE_KEYS = [
  'token',
  'authorization',
  'password',
  'secret',
  'private_key',
  'apikey',
  'api_key',
];

function redact(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.some((s) => k.toLowerCase().includes(s))) {
        out[k] = '***';
      } else {
        out[k] = redact(v);
      }
    }
    return out;
  }
  return value;
}

function write(level: Level, msg: string, meta?: unknown): void {
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${level.toUpperCase()}]`;
  const fn = level === 'debug' ? console.log : console[level];
  if (meta === undefined) {
    fn(`${prefix} ${msg}`);
  } else {
    fn(`${prefix} ${msg}`, redact(meta));
  }
}

export const logger = {
  debug: (msg: string, meta?: unknown) => {
    if (process.env.LOG_LEVEL === 'debug') write('debug', msg, meta);
  },
  info: (msg: string, meta?: unknown) => write('info', msg, meta),
  warn: (msg: string, meta?: unknown) => write('warn', msg, meta),
  error: (msg: string, meta?: unknown) => write('error', msg, meta),
};