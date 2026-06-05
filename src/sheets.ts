// Único módulo que fala com o Google Sheets. Lê abas inteiras e escreve em lote.
import { google, sheets_v4 } from 'googleapis';
import { env } from './config';
import type { Person, Task, MessageRow, TaskStatus, Periodicidade } from './types';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

export const TAB = {
  pessoas: 'Pessoas',
  tarefas: 'Tarefas',
  mensagens: 'Mensagens',
  config: 'Config',
} as const;

const TASK_HEADER = [
  'task_id', 'person_id', 'descricao', 'data', 'status', 'periodicidade',
  'cobrar', 'last_reminder_at', 'completed_at', 'skip_until', 'observacoes',
];
const MSG_HEADER = [
  'message_id', 'timestamp', 'direction', 'person_id', 'whatsapp_e164',
  'body', 'parsed_intent', 'related_task_id', 'status',
];

let sheetsClient: sheets_v4.Sheets | null = null;
const headerCache: Record<string, string[]> = {};

function getClient(): sheets_v4.Sheets {
  if (sheetsClient) return sheetsClient;
  const auth = new google.auth.JWT({
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: env.GOOGLE_PRIVATE_KEY,
    scopes: SCOPES,
  });
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

function colLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ===== Conversões de valor =====

function toBool(v: string): boolean {
  const s = String(v ?? '').trim().toUpperCase();
  return s === 'TRUE' || s === '1' || s === 'SIM' || s === 'VERDADEIRO';
}
function boolStr(b: boolean): string {
  return b ? 'TRUE' : 'FALSE';
}
function asStatus(v: string): TaskStatus {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'done' || s === 'skipped' || s === 'cancelled') return s;
  return 'pending';
}
function asPeriod(v: string): Periodicidade {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'weekly' || s === 'once') return s;
  return 'daily';
}

function taskToValues(t: Task): Record<string, string> {
  return {
    task_id: t.task_id,
    person_id: t.person_id,
    descricao: t.descricao,
    data: t.data,
    status: t.status,
    periodicidade: t.periodicidade,
    cobrar: boolStr(t.cobrar),
    last_reminder_at: t.last_reminder_at,
    completed_at: t.completed_at,
    skip_until: t.skip_until,
    observacoes: t.observacoes,
  };
}

function msgToValues(m: MessageRow): Record<string, string> {
  return {
    message_id: m.message_id,
    timestamp: m.timestamp,
    direction: m.direction,
    person_id: m.person_id,
    whatsapp_e164: m.whatsapp_e164,
    body: m.body,
    parsed_intent: m.parsed_intent,
    related_task_id: m.related_task_id,
    status: m.status,
  };
}

// ===== Leitura/escrita genérica =====

interface RawTable {
  header: string[];
  rows: { __row: number; values: Record<string, string> }[];
}

async function loadTable(tab: string): Promise<RawTable> {
  const client = getClient();
  const res = await client.spreadsheets.values.get({
    spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID,
    range: tab,
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const matrix = (res.data.values ?? []) as unknown[][];
  if (matrix.length === 0) return { header: [], rows: [] };

  const header = (matrix[0] ?? []).map((h) => String(h ?? '').trim());
  const rows = matrix.slice(1).map((arr, idx) => {
    const values: Record<string, string> = {};
    header.forEach((h, i) => {
      values[h] = arr[i] == null ? '' : String(arr[i]);
    });
    return { __row: idx + 2, values }; // +2: linha 1 é o header, base 1
  });
  return { header, rows };
}

function ensureHeader(tab: string, fallback: string[]): string[] {
  return headerCache[tab] && headerCache[tab].length ? headerCache[tab] : fallback;
}

async function writeRow(
  tab: string,
  header: string[],
  rowNumber: number,
  values: Record<string, string>,
): Promise<void> {
  const client = getClient();
  const arr = header.map((h) => values[h] ?? '');
  await client.spreadsheets.values.update({
    spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID,
    range: `${tab}!A${rowNumber}:${colLetter(header.length)}${rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [arr] },
  });
}

async function batchWriteRows(
  tab: string,
  header: string[],
  items: { rowNumber: number; values: Record<string, string> }[],
): Promise<void> {
  if (items.length === 0) return;
  const client = getClient();
  const data = items.map(({ rowNumber, values }) => ({
    range: `${tab}!A${rowNumber}:${colLetter(header.length)}${rowNumber}`,
    values: [header.map((h) => values[h] ?? '')],
  }));
  await client.spreadsheets.values.batchUpdate({
    spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID,
    requestBody: { valueInputOption: 'RAW', data },
  });
}

// ===== Loaders tipados =====

export async function loadPeople(): Promise<Person[]> {
  const { header, rows } = await loadTable(TAB.pessoas);
  headerCache[TAB.pessoas] = header;
  return rows
    .filter((r) => (r.values['person_id'] ?? '').trim() !== '')
    .map((r) => ({
      __row: r.__row,
      person_id: r.values['person_id'].trim(),
      nome: r.values['nome'] ?? '',
      whatsapp_e164: (r.values['whatsapp_e164'] ?? '').trim(),
      ativo: toBool(r.values['ativo']),
      opt_in: toBool(r.values['opt_in']),
      timezone: (r.values['timezone'] ?? '').trim(),
      observacoes: r.values['observacoes'] ?? '',
    }));
}

export async function loadTasks(): Promise<Task[]> {
  const { header, rows } = await loadTable(TAB.tarefas);
  headerCache[TAB.tarefas] = header;
  return rows
    .filter((r) => (r.values['task_id'] ?? '').trim() !== '')
    .map((r) => ({
      __row: r.__row,
      task_id: r.values['task_id'].trim(),
      person_id: (r.values['person_id'] ?? '').trim(),
      descricao: r.values['descricao'] ?? '',
      data: (r.values['data'] ?? '').trim(),
      status: asStatus(r.values['status']),
      periodicidade: asPeriod(r.values['periodicidade']),
      cobrar: toBool(r.values['cobrar']),
      last_reminder_at: r.values['last_reminder_at'] ?? '',
      completed_at: r.values['completed_at'] ?? '',
      skip_until: (r.values['skip_until'] ?? '').trim(),
      observacoes: r.values['observacoes'] ?? '',
    }));
}

export async function loadConfig(): Promise<Record<string, string>> {
  const { header, rows } = await loadTable(TAB.config);
  headerCache[TAB.config] = header;
  const cfg: Record<string, string> = {};
  for (const r of rows) {
    const k = (r.values['key'] ?? '').trim();
    if (k) cfg[k] = (r.values['value'] ?? '').trim();
  }
  return cfg;
}

export async function loadMessages(): Promise<MessageRow[]> {
  const { header, rows } = await loadTable(TAB.mensagens);
  headerCache[TAB.mensagens] = header;
  return rows.map((r) => ({
    __row: r.__row,
    message_id: r.values['message_id'] ?? '',
    timestamp: r.values['timestamp'] ?? '',
    direction: (r.values['direction'] === 'outbound' ? 'outbound' : 'inbound'),
    person_id: r.values['person_id'] ?? '',
    whatsapp_e164: r.values['whatsapp_e164'] ?? '',
    body: r.values['body'] ?? '',
    parsed_intent: r.values['parsed_intent'] ?? '',
    related_task_id: r.values['related_task_id'] ?? '',
    status: r.values['status'] ?? '',
  }));
}

// ===== Writers tipados =====

export async function saveTask(task: Task): Promise<void> {
  const header = ensureHeader(TAB.tarefas, TASK_HEADER);
  await writeRow(TAB.tarefas, header, task.__row, taskToValues(task));
}

export async function saveTasks(tasks: Task[]): Promise<void> {
  if (tasks.length === 0) return;
  const header = ensureHeader(TAB.tarefas, TASK_HEADER);
  const items = tasks.map((t) => ({ rowNumber: t.__row, values: taskToValues(t) }));
  await batchWriteRows(TAB.tarefas, header, items);
}

export async function appendMessage(msg: MessageRow): Promise<void> {
  const header = ensureHeader(TAB.mensagens, MSG_HEADER);
  const client = getClient();
  await client.spreadsheets.values.append({
    spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID,
    range: `${TAB.mensagens}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [header.map((h) => msgToValues(msg)[h] ?? '')] },
  });
}

export async function appendMessages(msgs: MessageRow[]): Promise<void> {
  if (msgs.length === 0) return;
  const header = ensureHeader(TAB.mensagens, MSG_HEADER);
  const client = getClient();
  const values = msgs.map((m) => header.map((h) => msgToValues(m)[h] ?? ''));
  await client.spreadsheets.values.append({
    spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID,
    range: `${TAB.mensagens}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });
}

// ===== Suporte ao CSV (backup/edição offline) =====

export async function dumpTab(tab: string): Promise<string[][]> {
  const client = getClient();
  const res = await client.spreadsheets.values.get({
    spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID,
    range: tab,
    valueRenderOption: 'FORMATTED_VALUE',
  });
  return ((res.data.values ?? []) as unknown[][]).map((r) =>
    r.map((c) => (c == null ? '' : String(c))),
  );
}

export async function overwriteTab(tab: string, matrix: string[][]): Promise<void> {
  const client = getClient();
  await client.spreadsheets.values.clear({
    spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID,
    range: tab,
  });
  if (matrix.length === 0) return;
  const maxCols = Math.max(1, ...matrix.map((r) => r.length));
  const rect = matrix.map((r) => {
    const c = r.slice();
    while (c.length < maxCols) c.push('');
    return c;
  });
  await client.spreadsheets.values.update({
    spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID,
    range: `${tab}!A1:${colLetter(maxCols)}${rect.length}`,
    valueInputOption: 'RAW',
    requestBody: { values: rect },
  });
}

export async function appendTask(task: Task): Promise<void> {
  const header = ensureHeader(TAB.tarefas, TASK_HEADER);
  const client = getClient();
  await client.spreadsheets.values.append({
    spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID,
    range: `${TAB.tarefas}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [header.map((h) => taskToValues(task)[h] ?? '')] },
  });
}

export async function pruneOldMessages(hours = 48): Promise<number> {
  const matrix = await dumpTab(TAB.mensagens);
  if (matrix.length <= 1) return 0; // só cabeçalho (ou vazia)

  const header = matrix[0];
  const tsIdx = header.indexOf('timestamp');
  if (tsIdx === -1) return 0;

  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const kept = matrix.slice(1).filter((row) => {
    const t = Date.parse(row[tsIdx] ?? '');
    if (Number.isNaN(t)) return true; // sem timestamp válido: não apaga, por segurança
    return t >= cutoff;
  });

  const removed = matrix.length - 1 - kept.length;
  if (removed > 0) await overwriteTab(TAB.mensagens, [header, ...kept]);
  return removed;
}

export async function purgeOldDoneOnceTasks(days = 14): Promise<number> {
  const matrix = await dumpTab(TAB.tarefas);
  if (matrix.length <= 1) return 0;
  const header = matrix[0];
  const perIdx = header.indexOf('periodicidade');
  const stIdx = header.indexOf('status');
  const compIdx = header.indexOf('completed_at');
  if (perIdx === -1 || stIdx === -1 || compIdx === -1) return 0;

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const kept = matrix.slice(1).filter((row) => {
    const per = String(row[perIdx] ?? '').trim().toLowerCase();
    const st = String(row[stIdx] ?? '').trim().toLowerCase();
    if (per !== 'once' || st !== 'done') return true; // só mexe em once+done
    const t = Date.parse(row[compIdx] ?? '');
    if (Number.isNaN(t)) return true; // sem data válida: não apaga, por segurança
    return t >= cutoff; // mantém se concluída há menos de `days` dias
  });

  const removed = matrix.length - 1 - kept.length;
  if (removed > 0) await overwriteTab(TAB.tarefas, [header, ...kept]);
  return removed;
}

// Remove uma tarefa pelo task_id, reescrevendo a aba. Retorna true se removeu.
export async function deleteTaskById(taskId: string): Promise<boolean> {
  const matrix = await dumpTab(TAB.tarefas);
  if (matrix.length <= 1) return false;
  const header = matrix[0];
  const idIdx = header.indexOf('task_id');
  if (idIdx === -1) return false;
  const kept = matrix.slice(1).filter((row) => String(row[idIdx] ?? '').trim() !== taskId);
  if (kept.length === matrix.length - 1) return false; // nada removido
  await overwriteTab(TAB.tarefas, [header, ...kept]);
  return true;
}