import type { Person, Letter, MessageRow, SendResult, IncomingMessage, GenericTask, AutoTask, Designated, AdminError, XEntry, Task } from './types';
import { nowIso, isoToLocalDate, weekdayName } from './time';
import type { XParseError } from './xlist';
import type { PersonScore } from './score';
import type { HouseAnalytics, PersonAnalytics } from './analytics';
import type { ModelFit, PersonProb } from './model';
import type { WeeklyBoard, WeeklyRow } from './weekly';
import type { CalendarItem } from './generictask';

// ===== Formatação de mensagens =====

const LATE_SUFFIX = ' (atrasada: vale meio ponto)';

function taskLabel(t: GenericTask): string {
  return t.kind === 'auto' && t.status === 'missed' ? `${t.descricao}${LATE_SUFFIX}` : t.descricao;
}

export function formatTaskListMultiline(tasks: GenericTask[]): string {
  return tasks.map((t, i) => `${i + 1}. ${taskLabel(t)}`).join('\n');
}

// Sem quebras de linha: exigência dos parâmetros de template do WhatsApp.
export function formatTaskListSingleLine(tasks: GenericTask[]): string {
  return tasks.map((t, i) => `${i + 1}) ${taskLabel(t)}`).join(' | ');
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

function swapDayWord(ymd: string): string {
  return weekdayName(ymd).replace(/-feira$/, '');
}

function swapDayTokens(dates: string[]): string[] {
  const words = dates.map(swapDayWord);
  if (new Set(words).size === words.length) return words;
  return dates.map((d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`);
}

export function formatSwapTaskAmbiguous(options: { descricao: string; data: string }[], paraNome: string): string {
  const tokens = swapDayTokens(options.map((o) => o.data));
  const lines = options.map((o, i) => `- trocar ${o.descricao} ${tokens[i]} ${paraNome}`);
  return ['Mais de uma tarefa parecida. Envie o comando da que você quer:', ...lines].join('\n');
}

export function formatSwapDateAmbiguous(descricao: string, dates: string[], paraNome: string): string {
  const tokens = swapDayTokens(dates);
  const lines = dates.map((d, i) => `- trocar ${descricao} ${tokens[i]} ${paraNome} (${formatSwapDateLabel(d)})`);
  return [`Você tem "${descricao}" em mais de um dia. Envie o comando com o dia que você quer:`, ...lines].join('\n');
}

export function formatSwapRecipientFuzzy(nome: string, command: string): string {
  return `Você quis dizer ${nome}? Para confirmar, envie: ${command}`;
}

export function formatSwapOpenReminder(deNome: string, descricao: string, ymd: string): string {
  return `Você tem um pedido de troca aberto: ${deNome} pediu para você assumir "${descricao}" (${formatSwapDateLabel(ymd)}). Responda "sim" para aceitar ou "não" para recusar.`;
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
    '- "semana" → gera um calendário das tarefas da sua semana, com a chance de cada tarefa automática',
    '- "ferias" → entra de férias',
    '- "voltar ferias" → volta de férias',
    '- "carta <nome> <mensagem>" → deixa uma carta para um morador (ele recebe o aviso no lembrete da manhã seguinte)',
    '- "cartas" → lê suas cartas novas',
    '- "trocar tirar lixo quarta Joao" → pede para alguém assumir uma tarefa automática sua (formato: trocar <tarefa> [dia] <nome>; o pedido vale por 1 hora)',
    '- "sim" / "não" → responde a um pedido de troca que você recebeu (com vários pedidos, "aceitar 2" ou "recusar 2")',
    '- "cancelar troca" → cancela seus pedidos de troca em aberto',
    '- "x lista" → mostra seus Xs (a punição da casa), com causa e data',
    '- "x tabela" → mostra quantos Xs cada morador tem',
    '- "x perdao <motivo>" → remove seu X mais antigo (todos são avisados do motivo)',
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

function dayMonth(ymd: string): string {
  const [, m, d] = ymd.split('-');
  return `${d}/${m}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function personNameOf(people: Person[], personId: string): string {
  return people.find((p) => p.person_id === personId)?.nome || personId;
}

function groupByPerson<T>(
  items: T[],
  personIdOf: (item: T) => string,
  people: Person[],
): { nome: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const id = personIdOf(item);
    const list = groups.get(id) ?? [];
    list.push(item);
    groups.set(id, list);
  }
  return [...groups.entries()]
    .map(([id, list]) => ({ nome: personNameOf(people, id), items: list }))
    .sort((x, y) => x.nome.localeCompare(y.nome));
}

function weekdayShort(ymd: string): string {
  return weekdayName(ymd).replace(/-feira$/, '');
}

export function formatNotDoneReport(
  missed: Designated[],
  late: Designated[],
  people: Person[],
  autoTasks: AutoTask[],
  range = 7,
): string {
  const title = `*Tarefas não feitas* (últimos ${range} dias)`;
  const entries = [
    ...missed.map((d) => ({ d, late: false })),
    ...late.map((d) => ({ d, late: true })),
  ].sort((x, y) =>
    x.d.data.localeCompare(y.d.data) ||
    personNameOf(people, x.d.person_id).localeCompare(personNameOf(people, y.d.person_id)) ||
    x.d.task_id.localeCompare(y.d.task_id));
  if (entries.length === 0) return `${title}\nNenhuma.`;
  const descFromTaskId = (tId: string) => autoTasks.find((a) => a.task_id === tId)?.descricao || tId;
  const lines = entries.map(({ d, late: isLate }) =>
    `• ${dayMonth(d.data)} (${weekdayShort(d.data)}) — ${descFromTaskId(d.task_id)} — ${personNameOf(people, d.person_id)}${isLate ? ' — *atrasada*' : ''}`);
  return [title, '', ...lines].join('\n');
}

export function formatStaleTasksReport(
  stale: { task: Task; dias: number }[],
  people: Person[],
): string {
  const title = '*Tarefas diárias e semanais em atraso*';
  if (stale.length === 0) return `${title}\nNenhuma.`;
  const blocks = groupByPerson(stale, (s) => s.task.person_id, people).map((g) => [
    `*${g.nome}* (${g.items.length})`,
    ...[...g.items]
      .sort((a, b) => b.dias - a.dias)
      .map((s) => `• ${s.task.descricao} — ${s.task.periodicidade === 'daily' ? 'diária' : 'semanal'}, ${plural(s.dias, 'dia', 'dias')} sem fazer`),
  ].join('\n'));
  return [title, '', blocks.join('\n\n')].join('\n');
}

const PERIODICIDADE_LABEL: Record<Task['periodicidade'], string> = {
  daily: 'diária',
  weekly: 'semanal',
  once: 'única',
};

const TASK_STATUS_LABEL: Partial<Record<Task['status'], string>> = {
  skipped: 'pulada',
  cancelled: 'cancelada',
};

export function formatAdminList(
  open: Task[],
  people: Person[],
  scope: string | null,
  emptyMsg: string,
): string {
  if (open.length === 0) return emptyMsg;
  const title = `*Tarefas em aberto${scope ? ` — ${scope}` : ''}* (${open.length})`;
  const blocks = groupByPerson(open, (t) => t.person_id, people).map((g) => [
    `*${g.nome}* (${g.items.length})`,
    ...[...g.items]
      .sort((a, b) => a.task_id.localeCompare(b.task_id))
      .map((t) => {
        const extra = [PERIODICIDADE_LABEL[t.periodicidade], TASK_STATUS_LABEL[t.status]].filter(Boolean).join(', ');
        return `• ${t.task_id} — ${t.descricao} (${extra})`;
      }),
  ].join('\n'));
  return [title, '', blocks.join('\n\n')].join('\n');
}

export function formatAdminAdded(
  descricao: string,
  periodicidade: Task['periodicidade'],
  grupo: string,
  criadas: { id: string; nome: string }[],
): string {
  const title = criadas.length === 1 ? '*Tarefa criada*' : `*Tarefas criadas* (${criadas.length})`;
  return [
    title,
    `"${descricao}" — ${PERIODICIDADE_LABEL[periodicidade]}`,
    ...(grupo ? [`Grupo: ${grupo}`] : []),
    '',
    ...criadas.map((c) => `• ${c.id} — ${c.nome}`),
  ].join('\n');
}

export function formatAdminRemovedTask(taskId: string, descricao: string, nome: string): string {
  return ['*Tarefa removida*', `${taskId} — "${descricao}" (${nome})`].join('\n');
}

export function formatAdminRemovedGroup(count: number, grupo: string, descricao: string): string {
  const title = count === 1 ? '*Tarefa removida*' : `*Tarefas removidas* (${count})`;
  return [title, `"${descricao}" — grupo ${grupo}`].join('\n');
}

const SCORE_ALERT_BELOW = 50;

function pct(x: number): string {
  return String(Math.round(x * 100));
}

function weightText(w: number): string {
  return w.toFixed(1).replace('.', ',');
}

function scoreLine(s: PersonScore, p: PersonProb): string {
  const alert = p.prob * 100 < SCORE_ALERT_BELOW ? '⚠️ ' : '';
  const vacation = s.ferias ? ' _(férias)_' : '';
  return `${alert}*${s.nome}* — ${pct(p.prob)}% de chance (mín. ${pct(p.lower)}%)${vacation}`;
}

function modelNote(fit: ModelFit): string {
  const mode = fit.fitted ? 'ajustado' : 'parâmetros padrão (poucos dados)';
  return `_Modelo ${mode}: ${Number.isFinite(fit.params.halfLifeDays) ? `meia-vida ${fit.params.halfLifeDays}d` : 'sem desconto de idade'}, prior ${fit.params.priorStrength}. Erro (Brier) ${decimal(fit.model.brier, 3)} contra ${decimal(fit.baseline.brier, 3)} de prever a média da casa para todos._`;
}

function scoreCounts(s: PersonScore): string {
  return `${plural(s.done, 'feita', 'feitas')} · ${plural(s.late, 'tardia', 'tardias')} · ${plural(s.missed, 'perdida', 'perdidas')} · peso ${weightText(s.weight)}`;
}

export function formatAdminScore(
  scores: PersonScore[],
  probs: PersonProb[],
  fit: ModelFit,
  windowDays: number,
): string {
  const rows = scores
    .map((s) => ({ s, p: probs.find((x) => x.person_id === s.person_id) }))
    .filter((r): r is { s: PersonScore; p: PersonProb } => r.p !== undefined);
  if (rows.length === 0) return '*Score*\nNenhuma pessoa ativa.';
  const ranked = [...rows].sort((a, b) => b.p.prob - a.p.prob || a.s.nome.localeCompare(b.s.nome));
  if (ranked.length === 1) {
    const { s, p } = ranked[0];
    return [
      scoreLine(s, p),
      scoreCounts(s),
      `Evidência efetiva: ${decimal(p.evidence)} · pendentes: ${s.pending}`,
      '',
      `_Contagens dos últimos ${windowDays} dias. "Chance" é a probabilidade estimada de a pessoa fazer a próxima tarefa; "mín." é o limite inferior._`,
      modelNote(fit),
    ].join('\n');
  }
  return [
    `*Score da casa* (últimos ${windowDays} dias)`,
    '',
    ranked.map(({ s, p }, i) => `${i + 1}. ${scoreLine(s, p)}\n    ${scoreCounts(s)}`).join('\n'),
    '',
    '_Chance = probabilidade estimada de fazer a próxima tarefa (tardia conta meia). Peso = multiplicador de cota na atribuição._',
    modelNote(fit),
  ].join('\n');
}

function decimal(n: number, digits = 1): string {
  return n.toFixed(digits).replace('.', ',');
}

function rateText(rate: number | null): string {
  return rate === null ? '—' : `${pct(rate)}%`;
}

function streakText(s: PersonAnalytics['streak']): string {
  if (!s) return '—';
  return `${s.length} ${s.kind === 'perdidas' ? (s.length === 1 ? 'perdida' : 'perdidas') : (s.length === 1 ? 'cumprida' : 'cumpridas')}`;
}

export function formatAnalyticsHouse(h: HouseAnalytics): string {
  const chance = (p: PersonAnalytics) => p.prob ?? p.score.mean;
  const active = h.people.filter((p) => p.ativo).sort((a, b) => chance(b) - chance(a) || a.nome.localeCompare(b.nome));
  if (active.length === 0) return '*Analytics da casa*\nNenhuma pessoa ativa.';
  const t = h.totals;
  const summary = [
    `• Designadas: ${t.assigned} (${plural(t.done, 'feita', 'feitas')} · ${plural(t.late, 'tardia', 'tardias')} · ${plural(t.missed, 'perdida', 'perdidas')} · ${plural(t.pending, 'pendente', 'pendentes')})`,
    `• Taxa efetiva: ${rateText(h.effectiveRate)}`,
    `• Carga por semana: ${decimal(h.perWeekMin)} a ${decimal(h.perWeekMax)} por pessoa`,
    ...(h.worstTask ? [`• Tarefa mais perdida: ${h.worstTask.descricao} (${h.worstTask.missed} de ${h.worstTask.total})`] : []),
    ...(h.lowScore.length > 0 ? [`⚠️ Score baixo: ${h.lowScore.join(', ')}`] : []),
  ];
  const lines = active.map((p, i) => {
    const vacation = p.ferias ? ' _(férias)_' : '';
    const last = p.lastAssigned ? `${dayMonth(p.lastAssigned)}` : '—';
    return [
      `${i + 1}. *${p.nome}* — chance ${pct(chance(p))}% · ${decimal(p.perWeek)}/sem · efetiva ${rateText(p.effectiveRate)}${vacation}`,
      `    última: ${last} · sequência: ${streakText(p.streak)}`,
    ].join('\n');
  });
  return [
    `*Analytics da casa* (últimos ${h.windowDays} dias)`,
    '',
    '*Resumo*',
    ...summary,
    '',
    '*Por pessoa* (ordenado pela chance de fazer a próxima tarefa)',
    lines.join('\n'),
    '',
    '_Taxa efetiva: feita = 1, tardia = 0,5, perdida = 0. Use "admin analytics -p nome" para o detalhe._',
  ].join('\n');
}

export function formatAnalyticsPerson(p: PersonAnalytics, windowDays: number): string {
  const chanceNow = p.prob ?? p.score.mean;
  const chanceLow = p.probLower ?? p.score.lower;
  const alert = chanceNow < 0.5 ? ' ⚠️' : '';
  const since = p.desde ? ` desde ${dayMonth(p.desde)}` : '';
  const last = p.lastAssigned
    ? `${dayMonth(p.lastAssigned)} (há ${plural(p.daysSinceLast ?? 0, 'dia', 'dias')})`
    : 'nenhuma na janela';
  const tasks = p.tasks.length === 0
    ? ['Nenhuma tarefa na janela.']
    : p.tasks.map((t) => `• ${t.descricao} — ${plural(t.total, 'designada', 'designadas')}, ${t.done} feita(s), ${t.late} tardia(s), ${t.missed} perdida(s)`);
  return [
    `*Analytics — ${p.nome}* (últimos ${windowDays} dias)${p.ferias ? ' _(férias)_' : ''}`,
    `Chance de fazer a próxima: ${pct(chanceNow)}% (mín. ${pct(chanceLow)}%) · peso ${decimal(p.score.weight)}${alert}`,
    `Designadas ${p.assigned} · ${plural(p.done, 'feita', 'feitas')} · ${plural(p.late, 'tardia', 'tardias')} · ${plural(p.missed, 'perdida', 'perdidas')} · ${plural(p.pending, 'pendente', 'pendentes')}`,
    `Taxa efetiva ${rateText(p.effectiveRate)} · no prazo ${rateText(p.onTimeRate)}`,
    `Carga ${decimal(p.perWeek)}/sem (exposição de ${plural(p.exposureDays, 'dia', 'dias')}${since})`,
    `Última designação: ${last}`,
    `Sequência atual: ${streakText(p.streak)}`,
    '',
    '*Por tarefa*',
    ...tasks,
  ].join('\n');
}

function moverLine(r: WeeklyRow, b: WeeklyBoard): string {
  const house = b.houseWeek === null ? '' : `; casa ${pct(b.houseBefore)}% → ${pct(b.houseWeek)}%`;
  return `• ${r.nome} — ${pct(r.weekRate ?? 0)}% em ${plural(r.n, 'tarefa', 'tarefas')} (antes ${pct(r.baseline)}%${house})`;
}

function changeMark(r: WeeklyRow): string {
  return r.change === 'up' ? ' ↑' : r.change === 'down' ? ' ↓' : '';
}

function formatReportBoard(b: WeeklyBoard, days: number): string[] {
  if (b.rows.length === 0) return ['*Chance de fazer a próxima tarefa*', 'Nenhuma pessoa ativa.'];
  const single = b.rows.length === 1;
  const ranking = b.rows.map((r, i) => {
    const vacation = r.ferias ? ' _(férias)_' : '';
    const prefix = single ? '' : `${i + 1}. `;
    return [
      `${prefix}*${r.nome}* — ${pct(r.prob)}%${changeMark(r)}${vacation}`,
      `    ${plural(r.done, 'feita', 'feitas')} · ${plural(r.late, 'tardia', 'tardias')} · ${plural(r.missed, 'perdida', 'perdidas')}`,
    ].join('\n');
  });
  const t = b.totals;
  const rate = t.assigned === 0 ? '—' : `${pct((t.done + 0.5 * t.late) / t.assigned)}%`;
  return [
    '*Chance de fazer a próxima tarefa*',
    ranking.join('\n'),
    '',
    '*Melhoraram*',
    ...(b.improved.length > 0 ? b.improved.map((r) => moverLine(r, b)) : ['• ninguém com evidência suficiente']),
    '',
    '*Pioraram*',
    ...(b.worsened.length > 0 ? b.worsened.map((r) => moverLine(r, b)) : ['• ninguém com evidência suficiente']),
    '_Compara a semana com o histórico da própria pessoa, ajustado pela casa. Só entra com 2+ tarefas na semana e evidência de mudança._',
    '',
    `*Totais nos últimos ${days} dias*`,
    `• ${t.assigned} designadas · ${plural(t.done, 'feita', 'feitas')} · ${plural(t.late, 'tardia', 'tardias')} · ${plural(t.missed, 'perdida', 'perdidas')}`,
    `• Taxa efetiva: ${rate}`,
    ...(b.lowChance.length > 0 ? [`⚠️ Chance abaixo de 50%: ${b.lowChance.join(', ')}`] : []),
  ];
}

export function formatAdminReport(
  missed: Designated[],
  late: Designated[],
  stale: { task: Task; dias: number }[],
  people: Person[],
  autoTasks: AutoTask[],
  range = 7,
  pessoaNome?: string,
  board?: WeeklyBoard,
): string {
  const title = pessoaNome ? `*Relatório — ${pessoaNome}*` : '*Relatório*';
  const header = board ? `${title} (${dayMonth(board.from)} a ${dayMonth(board.to)})` : title;
  return [
    header,
    '',
    formatNotDoneReport(missed, late, people, autoTasks, range),
    '',
    formatStaleTasksReport(stale, people),
    ...(board ? ['', ...formatReportBoard(board, range), '', modelNote(board.fit)] : []),
  ].join('\n');
}

export function formatChance(prob: number): string {
  if (prob >= 1) return '100%';
  return `${Math.max(1, Math.min(99, Math.round(prob * 100)))}%`;
}

export function formatCalendarItem(item: CalendarItem): string {
  return item.prob === undefined ? item.descricao : `${item.descricao} (${formatChance(item.prob)})`;
}

export function formatWeekText(
  name: string, 
  combined: GenericTask[], 
  calendar: { data: string; itens: CalendarItem[] }[]
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
    `Calendário da Semana (as tarefas automáticas de dias futuros são previsões, com a chance de cada uma):`,
    calendar.map((d) => `- *${weekdayName(d.data)}*: ${d.itens.map(formatCalendarItem).join(', ')}`).join('\n')
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
    case 'invalid_range':
      return 'Período inválido. Use um número inteiro de dias maior que 0. Ex.: admin report 14';
    case 'duplicate_flag':
      return `Flag repetida. Apenas flags do tipo '-p' em operação de add podem ser repetidas.`
    default: {
      const _exhaustive: never = error;
      return _exhaustive;
    }
  }
}

export function formatSwapRecipientNotFound(): string {
  return 'Não encontrei ninguém com esse nome. Confira o nome e tente de novo.';
}

export function formatSwapSelfUnavailable(): string {
  return 'Você está de férias e não pode assumir tarefas. Envie "voltar ferias" e peça de novo.';
}

export function formatSwapInProgress(): string {
  return 'Esse pedido já está sendo processado.';
}

const pluralX = (n: number) => (n === 1 ? '1 X' : `${n} Xs`);

export function formatXUsage(): string {
  return [
    'Comandos do X:',
    '- "x lista" → seus Xs, com causa e data',
    '- "x tabela" → quantidade de Xs de cada morador',
    '- "x perdao <motivo>" → remove seu X mais antigo (todos são avisados)',
  ].join('\n');
}

export function formatXAdminUsage(): string {
  return 'Uso: x add -p <nome> [n] -m "<causa>" | x remove -p <nome> [n]\nExemplo: x add -p Joao 2 -m "louça acumulada"';
}

export function formatXParseError(error: XParseError): string {
  switch (error) {
    case 'unknown_sub':
      return formatXUsage();
    case 'missing_reason':
      return 'Faltou o motivo. Ex.: x perdao cumpri a tarefa atrasada';
    case 'missing_target':
    case 'bad_syntax':
      return formatXAdminUsage();
    case 'invalid_count':
      return 'Quantidade inválida. Use um número inteiro. Ex.: x add -p Joao 2 -m "causa"';
    case 'zero_count':
      return 'Quantidade zero: nada a fazer. Use um número maior que 0.';
  }
}

export function formatXAdminOnly(): string {
  return 'Só administradores podem usar esse comando do X.';
}

export function formatXTargetNotFound(query: string): string {
  return `Não encontrei "${query}". Tente o nome completo ou o pId.`;
}

export function formatXTargetAmbiguous(query: string): string {
  return `O nome "${query}" está ambíguo. Tente escrever mais precisamente ou digitar o pId.`;
}

export function formatXSaveFailed(): string {
  return 'Não consegui registrar agora. Tente de novo em instantes.';
}

export function formatXList(entries: XEntry[], tz: string): string {
  if (entries.length === 0) return 'Você não tem nenhum X.';
  const lines = entries.map((x, i) => {
    const ymd = isoToLocalDate(x.criada_em, tz);
    const date = ymd ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : 'data desconhecida';
    return `${i + 1}. ${date} - ${x.causa}`;
  });
  return [`Você tem ${pluralX(entries.length)}:`, ...lines].join('\n');
}

export function formatXTable(rows: { nome: string; count: number }[]): string {
  if (rows.length === 0) return 'Ninguém na tabela do X.';
  return ['Tabela do X:', ...rows.map((r) => `${r.nome}: ${r.count}`)].join('\n');
}

export function formatXAdded(nome: string, n: number, causa: string, total: number): string {
  return `${pluralX(n)} para ${nome} (${causa}). Total: ${total}.`;
}

export function formatXReceived(n: number, causa: string, total: number): string {
  return `Você recebeu ${pluralX(n)} (${causa}). Total: ${total}. Envie "x lista" para ver.`;
}

export function formatXThreshold(nome: string, total: number): string {
  return `${nome} chegou a ${pluralX(total)}. A partir do 3º X existem punições.`;
}

export function formatXRemovedAdmin(nome: string, n: number, total: number): string {
  return `Removido(s) ${n} X de ${nome}. Total: ${total}.`;
}

export function formatXRemoveNone(nome: string): string {
  return `${nome} não tem X.`;
}

export function formatXForgivenSelf(motivo: string, total: number): string {
  return `X removido. Motivo: ${motivo}. Você agora tem ${pluralX(total)}.`;
}

export function formatXForgivenNone(): string {
  return 'Você não tem X para remover.';
}

export function formatXForgivenNotice(nome: string, motivo: string, total: number): string {
  return `${nome} removeu 1 X. Motivo: ${motivo}. Agora tem ${pluralX(total)}.`;
}
