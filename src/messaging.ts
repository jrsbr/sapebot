import type { Person, MessageRow, SendResult, IncomingMessage, GenericTask, AutoTask, Designated, AdminError } from './types';
import { nowIso, isoToLocalDate, weekdayName } from './time';

// ===== Formatação de mensagens =====

export function formatTaskListMultiline(tasks: GenericTask[]): string {
  return tasks.map((t, i) => `${i + 1}. ${t.descricao}`).join('\n');
}

// Sem quebras de linha: exigência dos parâmetros de template do WhatsApp.
export function formatTaskListSingleLine(tasks: GenericTask[]): string {
  return tasks.map((t, i) => `${i + 1}) ${t.descricao}`).join(' | ');
}

export function formatReminderText(nome: string, tasks: GenericTask[]): string {
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

export function formatStatusText(nome: string, pending: GenericTask[]): string {
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
    '- "semana" → gera um calendário das tarefas da sua semana',
    '- "ferias" → entra de férias',
    '- "voltar ferias" → volta de férias',
    '- "ajuda" → mostra esta mensagem',
  ].join('\n');
}

export function buildInboundRow(
  msg: IncomingMessage,
  person: Person | undefined,
): MessageRow {
  return {
    message_id: msg.id || `in-${Date.now()}`,
    timestamp: nowIso(),
    direction: 'inbound',
    person_id: person?.person_id ?? '',
    whatsapp_e164: msg.from,
    body: msg.type === 'text' ? (msg.text?.body ?? '') : '',
    parsed_intent: '',
    related_task_id: '',
    status: 'received',
  };
}

export function buildOutboundRow(
  phone: string,
  personId: string,
  body: string,
  intent: string,
  relatedKey: string,
  result: SendResult,
): MessageRow {
  return {
    message_id: result.id ?? `out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: nowIso(),
    direction: 'outbound',
    person_id: personId,
    whatsapp_e164: phone,
    body,
    parsed_intent: intent,
    related_task_id: relatedKey,
    status: result.ok ? 'sent' : `error:${result.error ?? 'desconhecido'}`,
  };
}

export function within24h(messages: MessageRow[], personId: string): boolean {
  const inbound = messages.filter(
    (m) => m.direction === 'inbound' && m.person_id === personId && m.timestamp,
  );
  if (inbound.length === 0) return false;
  const last = inbound.reduce((acc, m) => (m.timestamp > acc ? m.timestamp : acc), '');
  const t = Date.parse(last);
  if (Number.isNaN(t)) return false;
  return Date.now() - t < 24 * 60 * 60 * 1000;
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
      m.status === 'sent' &&
      isoToLocalDate(m.timestamp, tz) === todayLocal,
  );
}

export function formatMissedReport(
  missed: Designated[], 
  people: Person[], 
  autoTasks: AutoTask[],
): string {
  if (missed.length === 0) return 'Nenhuma tarefa automática perdida nos últimos 7 dias.';
  const nameFromPersonId = (pId: string) => people.find((p) => p.person_id === pId)?.nome || pId;
  const descFromTaskId = (tId: string) => autoTasks.find((a) => a.task_id === tId)?.descricao || tId;
  return [
    `Aqui está a lista de todas as tarefas não feitas nos últimos 7 dias:`, 
    '',
    missed.map((m, i) => `${i + 1}. ${m.data} - ${descFromTaskId(m.task_id)} - ${nameFromPersonId(m.person_id)}`).join('\n')].join('\n');
}

export function formatWeekText(
  name: string, 
  combined: GenericTask[], 
  calendar: { data: string; descricoes: string[] }[]
): string {
  let reply: string = `Olá, ${name}. Você não tem tarefas pendentes para hoje!\n`;
  if (combined.length > 0) reply = [
    `Olá, ${name}. Tarefas pendentes hoje:`,
    formatTaskListMultiline(combined),
    ''
  ].join('\n');
  if (calendar.length === 0) return [
    reply,
    'O calendário da sua semana está vazio, aproveite!'
  ]. join('\n');
  return [
    reply,
    `Calendário da Semana:`,
    calendar.map((d) => `- *${weekdayName(d.data)}*: ${d.descricoes.join(', ')}`).join('\n')
  ].join('\n');
}

export function adminErrorMessage(error: AdminError): string {
  switch (error) {
    case 'unclosed_quote':
      return 'Aspas não fechada. Use aspas duplas em pares. Ex.: admin add -p João -m "lavar a louça" -d';
    case 'unknown_flag':
      return 'Flag não reconhecida por esse comando. Ex.: admin add -p João -m "lavar a louça" -d';
    case 'missing_value':
      return 'Uma flag ficou sem valor. Ex.: admin add -p João -m "lavar a louça" -d';
    case 'unknown_subcommand':
      return 'Subcomando inválido. Use: add, remove, list ou report.';
    case 'missing_description':
      return 'Faltou a descrição (-m). Ex.: admin add -p João -m "lavar a louça" -d';
    case 'missing_target':
      return 'Faltou o alvo: -p (pessoa) ou -g (grupo). Ex.: admin add -p João -m "lavar a louça" -d';
    case 'target_conflict':
      return 'Use só um alvo: -p (pessoa) ou -g (grupo), não os dois.';
    case 'periodicity_conflict':
      return 'Escolha só uma periodicidade: -o (uma vez), -w (semanal) ou -d (diária).';
    case 'missing_periodicity':
      return 'Faltou a periodicidade: -o (uma vez), -w (semanal) ou -d (diária). Ex.: admin add -p João -m "lavar a louça" -d';
    case 'invalid_date':
      return 'Data inválida. Use o formato AAAA-MM-DD. Ex.: -t 2026-06-20';
    case 'duplicate_flag':
      return `Flag repetida. Apenas flags do tipo '-p' em operação de add podem ser repetidas.`
    default: {
      const _exhaustive: never = error;
      return _exhaustive;
    }
  }
}