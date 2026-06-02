// Regras de negócio puras (sem I/O), tipos do domínio e formatação de mensagens.
import { Intent, normalizeText } from './parser';
import { daysBetween, isoToLocalDate } from './time';

// ===== Tipos do domínio =====

export type TaskStatus = 'pending' | 'done' | 'skipped' | 'cancelled';
export type Periodicidade = 'daily' | 'weekly' | 'once';

export interface Person {
  __row: number;
  person_id: string;
  nome: string;
  whatsapp_e164: string;
  ativo: boolean;
  opt_in: boolean;
  timezone: string;
  observacoes: string;
}

export interface Task {
  __row: number;
  task_id: string;
  person_id: string;
  descricao: string;
  data: string; // YYYY-MM-DD
  status: TaskStatus;
  periodicidade: Periodicidade;
  cobrar: boolean;
  last_reminder_at: string;
  completed_at: string;
  skip_until: string;
  observacoes: string;
}

export interface MessageRow {
  __row?: number;
  message_id: string;
  timestamp: string;
  direction: 'inbound' | 'outbound';
  person_id: string;
  whatsapp_e164: string;
  body: string;
  parsed_intent: string;
  related_task_id: string;
  status: string;
}

// ===== Telefone =====

export function onlyDigits(s: string): string {
  return (s ?? '').replace(/\D/g, '');
}

export function findPersonByPhone(people: Person[], phone: string): Person | undefined {
  const digits = onlyDigits(phone);
  if (!digits) return undefined;
  return people.find((p) => onlyDigits(p.whatsapp_e164) === digits);
}

// ===== Seleção de tarefas =====

function isPausedBySkip(task: Task, today: string): boolean {
  if (!task.skip_until) return false;
  // Pausada se skip_until for hoje ou no futuro.
  return task.skip_until >= today;
}

function isDue(task: Task, today: string): boolean {
  if (!task.data) return true;
  return task.data <= today;
}

// Lista de tarefas do dia para uma pessoa, ordenada de forma determinística
// (por task_id) — é o que garante que "feito 1" case com o "1" do lembrete.
export function getPendingTasksForToday(tasks: Task[], personId: string, today: string): Task[] {
  return tasks
    .filter(
      (t) =>
        t.person_id === personId &&
        t.status === 'pending' &&
        t.cobrar === true &&
        !isPausedBySkip(t, today) &&
        isDue(t, today),
    )
    .sort((a, b) => a.task_id.localeCompare(b.task_id));
}

// Virada de recorrentes: tarefas daily/weekly cuja instância ficou no passado
// voltam para "pending" hoje. Mutaciona os objetos recebidos e retorna os alterados.
export function rolloverRecurringTasks(tasks: Task[], today: string): Task[] {
  const changed: Task[] = [];
  for (const t of tasks) {
    if (t.status === 'cancelled') continue;
    if (t.periodicidade === 'once') continue;
    if (!t.data) continue; // sem data não há como decidir a virada
    if (t.data >= today) continue; // já está no dia atual ou no futuro

    let due = false;
    if (t.periodicidade === 'daily') {
      due = true;
    } else if (t.periodicidade === 'weekly') {
      due = daysBetween(t.data, today) >= 7;
    }
    if (!due) continue;

    t.data = today;
    t.status = 'pending';
    t.cobrar = true;
    t.completed_at = '';
    t.skip_until = '';
    changed.push(t);
  }
  return changed;
}

// ===== Atualizações de tarefa =====

export function markDone(task: Task, when: string): Task {
  task.status = 'done';
  task.completed_at = when;
  task.cobrar = false;
  return task;
}

export function markSkippedForToday(task: Task, today: string): Task {
  task.status = 'skipped';
  task.skip_until = today;
  task.cobrar = false;
  return task;
}

// ===== Casamento por descrição ("feito lavar louça") =====

export function findTaskByDescription(
  pending: Task[],
  query: string,
): { match?: Task; ambiguous: Task[] } {
  const q = normalizeText(query);
  if (!q) return { ambiguous: [] };
  const qTokens = q.split(' ').filter(Boolean);

  const scored = pending
    .map((t) => {
      const desc = normalizeText(t.descricao);
      const descTokens = new Set(desc.split(' ').filter(Boolean));
      const allTokensPresent = qTokens.every((tok) => desc.includes(tok));
      const overlap = qTokens.filter((tok) => descTokens.has(tok)).length;
      let score = 0;
      if (desc === q) score = 100;
      else if (allTokensPresent) score = 60 + overlap;
      else if (desc.includes(q)) score = 40;
      else score = overlap;
      return { task: t, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { ambiguous: [] };
  if (scored.length === 1) return { match: scored[0].task, ambiguous: [] };
  if (scored[0].score > scored[1].score) return { match: scored[0].task, ambiguous: [] };

  const top = scored.filter((s) => s.score === scored[0].score).map((s) => s.task);
  return { ambiguous: top };
}

// ===== Resolução de alvos para done/skip =====

export interface ResolveResult {
  targets: Task[];
  invalidNumbers: number[];
  ambiguous: Task[];
  markedAll: boolean;
  emptyList: boolean;
}

export function resolveTargets(
  intent: Extract<Intent, { type: 'done' | 'skip' }>,
  pending: Task[],
): ResolveResult {
  const base: ResolveResult = {
    targets: [],
    invalidNumbers: [],
    ambiguous: [],
    markedAll: false,
    emptyList: false,
  };

  if (pending.length === 0) return { ...base, emptyList: true };

  // Texto livre
  if (intent.query) {
    const { match, ambiguous } = findTaskByDescription(pending, intent.query);
    if (match) return { ...base, targets: [match] };
    return { ...base, ambiguous };
  }

  // Índices
  if (intent.indices && intent.indices.length > 0) {
    const targets: Task[] = [];
    const invalid: number[] = [];
    for (const n of intent.indices) {
      const t = pending[n - 1];
      if (t) targets.push(t);
      else invalid.push(n);
    }
    return { ...base, targets, invalidNumbers: invalid };
  }

  // Sem argumento (ex.: "feito")
  if (pending.length === 1) return { ...base, targets: [pending[0]] };
  // Várias pendentes -> marca todas, deixando explícito na resposta.
  return { ...base, targets: [...pending], markedAll: true };
}

export function dedupeByRow(tasks: Task[]): Task[] {
  const map = new Map<number, Task>();
  for (const t of tasks) map.set(t.__row, t);
  return [...map.values()];
}

// ===== Idempotência =====

export function reminderTaskKey(tasks: Task[]): string {
  return tasks.map((t) => t.task_id).sort().join(',');
}

export function alreadyRemindedToday(
  messages: MessageRow[],
  personId: string,
  todayLocal: string,
  taskKey: string,
  tz: string,
): boolean {
  return messages.some(
    (m) =>
      m.direction === 'outbound' &&
      m.person_id === personId &&
      m.parsed_intent === 'reminder' &&
      m.related_task_id === taskKey &&
      isoToLocalDate(m.timestamp, tz) === todayLocal,
  );
}

// ===== Formatação de mensagens =====

export function formatTaskListMultiline(tasks: Task[]): string {
  return tasks.map((t, i) => `${i + 1}. ${t.descricao}`).join('\n');
}

// Sem quebras de linha: exigência dos parâmetros de template do WhatsApp.
export function formatTaskListSingleLine(tasks: Task[]): string {
  return tasks.map((t, i) => `${i + 1}) ${t.descricao}`).join(' | ');
}

export function formatReminderText(nome: string, tasks: Task[]): string {
  return [
    `Oi, ${nome}. Suas tarefas de hoje são:`,
    '',
    formatTaskListMultiline(tasks),
    '',
    'Responda:',
    '- "feito 1" para marcar uma tarefa como concluída',
    '- "feito" se todas já foram feitas',
    '- "status" para ver o que ainda falta',
    '- "ajuda" para ver os comandos',
  ].join('\n');
}

export function formatNoTasksText(nome: string): string {
  return `Oi, ${nome}. Você não tem tarefas pendentes hoje. 🎉`;
}

export function formatStatusText(nome: string, pending: Task[]): string {
  if (pending.length === 0) {
    return `Tudo certo, ${nome}! Você não tem tarefas pendentes hoje. 🎉`;
  }
  return [`${nome}, ainda faltam:`, '', formatTaskListMultiline(pending)].join('\n');
}

export function formatHelpText(): string {
  return [
    'Comandos disponíveis:',
    '- "feito" → marca sua tarefa como concluída (ou todas, se houver várias)',
    '- "feito 1" → marca a tarefa número 1 da lista de hoje',
    '- "feito 1,2" → marca as tarefas 1 e 2',
    '- "feito lavar louça" → marca pela descrição',
    '- "pular 1" → pula a tarefa 1 só por hoje',
    '- "status" → mostra o que ainda falta hoje',
    '- "ajuda" → mostra esta mensagem',
  ].join('\n');
}