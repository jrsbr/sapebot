import type { Person, Letter, MessageRow, SendResult, IncomingMessage, GenericTask, AutoTask, Designated, AdminError } from './types';
import { nowIso, isoToLocalDate, weekdayName } from './time';

// ===== Formatação de mensagens =====

export function formatTaskListMultiline(tasks: GenericTask[]): string {
  return tasks.map((t, i) => `${i + 1}. ${t.descricao}`).join('\n');
}

// Sem quebras de linha: exigência dos parâmetros de template do WhatsApp.
export function formatTaskListSingleLine(tasks: GenericTask[]): string {
  return tasks.map((t, i) => `${i + 1}) ${t.descricao}`).join(' | ');
}

export const LETTER_NOTICE = '* Você tem mensagens não lidas. Envie "cartas" para ler.';
const LETTER_NOTICE_SINGLE_LINE = '* Você tem mensagens não lidas (envie "cartas")';

export function buildTaskListParam(tasks: GenericTask[], hasLetters: boolean): string {
  const base = tasks.length > 0 ? formatTaskListSingleLine(tasks) : 'Nenhuma tarefa hoje';
  return hasLetters ? `${base} | ${LETTER_NOTICE_SINGLE_LINE}` : base;
}

export function formatLettersOnlyMorningText(phrase: string): string {
  return `${phrase}\n\n${LETTER_NOTICE}`;
}

export function formatReminderText(
  nome: string,
  tasks: GenericTask[],
  hasLetters = false,
): string {
  return [
    `Oi, ${nome}. Suas tarefas de hoje são:`,
    '',
    formatTaskListMultiline(tasks),
    '',
    ...(hasLetters ? [LETTER_NOTICE, ''] : []),
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

export function formatSwapDateLabel(ymd: string): string {
  const [, m, d] = ymd.split('-');
  return `${weekdayName(ymd).replace(/-feira$/, '')}, ${d}/${m}`;
}

export function formatSwapRequestToTarget(deNome: string, descricao: string, ymd: string): string {
  return `${deNome} pediu para você assumir a tarefa "${descricao}" (${formatSwapDateLabel(ymd)}). Responda "sim" para aceitar ou "não" para recusar. O pedido vale por 1 hora.`;
}

export function formatSwapRequestSent(paraNome: string, descricao: string, ymd: string): string {
  return `Pedido enviado para ${paraNome}: "${descricao}" (${formatSwapDateLabel(ymd)}). Te aviso quando a resposta chegar. O pedido vale por 1 hora.`;
}

export function formatSwapUsage(): string {
  return 'Para pedir uma troca: trocar <tarefa> [dia] <nome>\nExemplo: trocar tirar lixo quarta Joao';
}

export function formatSwapBadDay(dayToken: string): string {
  return `Não entendi o dia "${dayToken}". Use hoje, amanhã, um dia da semana ou dd/mm (não pode ser data passada).`;
}

export function formatSwapTaskNotFound(taskQuery: string, ymd: string | null): string {
  return `Não encontrei "${taskQuery}" entre suas tarefas automáticas pendentes${ymd ? ` em ${formatSwapDateLabel(ymd)}` : ''}. Envie "semana" para ver suas tarefas.`;
}

export function formatSwapTaskAmbiguous(options: { descricao: string; data: string }[]): string {
  const lines = options.map((o, i) => `${i + 1}. ${o.descricao} (${formatSwapDateLabel(o.data)})`);
  return ['Mais de uma tarefa parecida:', ...lines, 'Envie de novo com o nome mais completo ou o dia.'].join('\n');
}

export function formatSwapTargetOnVacation(nome: string): string {
  return `${nome} está de férias.`;
}

export function formatSwapTargetOutsideWindow(nome: string): string {
  return `Não consegui pedir a ${nome}: ${nome} não falou com o Sapebot nas últimas 24h. Peça para mandar qualquer mensagem aqui e tente de novo.`;
}

export function formatSwapDuplicate(): string {
  return 'Já existe um pedido de troca em aberto para essa tarefa.';
}

export function formatSwapSendFailed(paraNome: string): string {
  return `Não consegui avisar ${paraNome} agora. Tente de novo em instantes.`;
}

export function formatSwapSaveFailed(): string {
  return 'Não consegui registrar o pedido agora. Tente de novo em instantes.';
}

export function formatSwapAcceptedToTarget(deNome: string, descricao: string, ymd: string): string {
  return `Combinado! Você ficou com "${descricao}" (${formatSwapDateLabel(ymd)}) no lugar de ${deNome}.`;
}

export function formatSwapAcceptedToRequester(paraNome: string, descricao: string, ymd: string): string {
  return `${paraNome} aceitou fazer "${descricao}" (${formatSwapDateLabel(ymd)}) no seu lugar.`;
}

export function formatSwapDeclinedToTarget(): string {
  return 'Ok, pedido recusado.';
}

export function formatSwapDeclinedToRequester(paraNome: string, descricao: string, ymd: string): string {
  return `${paraNome} recusou o pedido de troca de "${descricao}" (${formatSwapDateLabel(ymd)}).`;
}

export function formatSwapStale(): string {
  return 'Esse pedido não vale mais (a tarefa já foi feita ou mudou).';
}

export function formatSwapChoose(list: { deNome: string; descricao: string; data: string }[]): string {
  const lines = list.map((s, i) => `${i + 1}. ${s.deNome}: "${s.descricao}" (${formatSwapDateLabel(s.data)})`);
  return ['Você tem mais de um pedido de troca:', '', ...lines, '', 'Responda "aceitar 1" ou "recusar 1" (use o número do pedido).'].join('\n');
}

export function formatSwapInvalidNumber(): string {
  return 'Número inválido. Responda "aceitar N" ou "recusar N" com o número da lista.';
}

export function formatSwapCancelledToRequester(n: number): string {
  return `Cancelei ${n} pedido${n === 1 ? '' : 's'} de troca.`;
}

export function formatSwapNothingToCancel(): string {
  return 'Você não tem pedidos de troca abertos.';
}

export function formatSwapCancelledToTarget(deNome: string, descricao: string, ymd: string): string {
  return `${deNome} cancelou o pedido de troca de "${descricao}" (${formatSwapDateLabel(ymd)}).`;
}

export function formatSwapTargetNotAvailable(nome: string): string {
  return `${nome} não está disponível para assumir tarefas agora.`;
}

export function formatHelpText(): string {
  return [
    'Comandos disponíveis:',
    '- "feito" → marca sua tarefa como concluída (ou todas, se houver várias)',
    '- "feito 1" → marca a tarefa número 1 da lista de hoje',
    '- "feito 1,2" → marca as tarefas 1 e 2',
    '- "feito lavar louça" → marca pela descrição',
    '- "pular 1" → pula a tarefa 1 só por hoje',
    '- "pular lavar louça" → pula pela descrição',
    '- "status" → mostra o que ainda falta hoje',
    '- "semana" → gera um calendário das tarefas da sua semana',
    '- "ferias" → entra de férias',
    '- "voltar ferias" → volta de férias',
    '- "carta <nome> <mensagem>" → deixa uma carta para um morador (ele recebe o aviso no lembrete da manhã seguinte)',
    '- "cartas" → lê suas cartas novas',
    '- "ajuda" → mostra esta mensagem',
  ].join('\n');
}

const pluralCartas = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function formatLettersReply(
  letters: Letter[],
  people: Person[],
  tz: string,
  maxChars = 3500,
): { text: string; shown: Letter[]; remaining: number } {
  if (letters.length === 0) {
    return { text: 'Você não tem cartas novas.', shown: [], remaining: 0 };
  }
  const total = letters.length;
  const header = `Você tem ${total} ${pluralCartas(total, 'carta nova', 'cartas novas')}:`;
  const blocks = letters.map((l) => {
    const nome = people.find((p) => p.person_id === l.de_person_id)?.nome ?? 'alguém';
    const ymd = isoToLocalDate(l.criada_em, tz);
    const date = ymd ? ` (${ymd.slice(8, 10)}/${ymd.slice(5, 7)})` : '';
    return `De ${nome}${date}:\n${l.texto}`;
  });
  const footerFor = (remaining: number) =>
    remaining > 0
      ? `Há mais ${remaining} ${pluralCartas(remaining, 'carta', 'cartas')}. Envie "cartas" de novo para ler.`
      : '';
  const build = (count: number) => {
    const footer = footerFor(total - count);
    return [header, ...blocks.slice(0, count), ...(footer ? [footer] : [])].join('\n\n');
  };
  let count = 1;
  while (count < total && build(count + 1).length <= maxChars) count++;
  return { text: build(count), shown: letters.slice(0, count), remaining: total - count };
}

export function formatLetterSent(
  destNome: string,
  dayLabel: 'hoje' | 'amanhã',
  hour: number,
  minute: number,
): string {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return `Carta para ${destNome} registrada. Ela chega no aviso das ${hh}:${mm} de ${dayLabel}.`;
}

export function formatLetterUsage(): string {
  return 'Para enviar: carta <nome> <mensagem>\nExemplo: carta Carlos o jantar é às 20h\nPara ler suas cartas: cartas';
}

export function formatLetterConfirm(destNome: string): string {
  return `Você quis dizer ${destNome}? Responda "sim" em até 1 minuto para enviar a carta, ou "não" para cancelar.`;
}

export function formatLetterAmbiguous(nomes: string[]): string {
  return `Mais de uma pessoa parecida: ${nomes.join(', ')}. Envie de novo com o nome completo.`;
}

export function formatLetterNotFound(): string {
  return 'Não encontrei ninguém com esse nome. Confira o nome e tente de novo.\nPara enviar: carta <nome> <mensagem>';
}

export function formatLetterTooLong(len: number, max: number): string {
  return `Carta muito longa (máx. ${max} caracteres; a sua tem ${len}).`;
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