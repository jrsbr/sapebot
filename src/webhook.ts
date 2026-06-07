// Rotas do webhook da Meta: verificação (GET) e recebimento de mensagens (POST).
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { env } from './config';
import { logger } from './logger';
import { nowIso, localDate } from './time';
import {
  loadPeople, loadTasks, loadMessages, saveTasks, appendMessage, appendTask, deleteTaskById
} from './sheets';
import { Intent, parseMessage } from './parser';
import {
  ResolveResult,
  findPersonByPhone, getPendingTasksForToday, resolveTargets,
  markDone, markSkippedForToday, dedupeByRow,
  brPhoneKey, onlyDigits, findTaskByDescription,
  findPersonByIdOrName
} from './tasks';
import { formatStatusText, formatHelpText, formatTaskListMultiline, buildOutboundRow, buildInboundRow
 } from './messaging';
import { sendText } from './whatsapp';
import type { Person, Task, MessageRow, IncomingMessage } from './types'

export const webhookRouter = Router();

// GET /webhook — verificação da Meta
webhookRouter.get('/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === env.META_VERIFY_TOKEN) {
    logger.info('Webhook verificado pela Meta com sucesso.');
    return res.status(200).send(String(challenge ?? ''));
  }
  logger.warn('Falha na verificação do webhook (token incorreto).');
  return res.sendStatus(403);
});

// POST /webhook — recebimento de mensagens
webhookRouter.post('/webhook', (req: Request, res: Response) => {
  if (!verifySignature(req)) {
    logger.warn('Assinatura do webhook inválida.');
    return res.sendStatus(401);
  }
  // Responde 200 imediatamente; processa em segundo plano (a Meta exige resposta rápida).
  res.sendStatus(200);
  processWebhookBody(req.body).catch((err) =>
    logger.error('Erro ao processar webhook', { error: (err as Error).message }),
  );
});

function verifySignature(req: Request): boolean {
  if (!env.META_APP_SECRET) return true; // não configurado -> não valida
  const signature = req.header('x-hub-signature-256');
  const raw = (req as any).rawBody as Buffer | undefined;
  if (!signature || !raw) return false;
  const expected =
    'sha256=' + crypto.createHmac('sha256', env.META_APP_SECRET).update(raw).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

function extractMessages(body: any): IncomingMessage[] {
  const out: IncomingMessage[] = [];
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const m of change?.value?.messages ?? []) {
        out.push({ from: m.from, id: m.id, type: m.type, text: m.text });
      }
    }
  }
  return out;
}

async function processWebhookBody(body: any): Promise<void> {
  const incoming = extractMessages(body);
  if (incoming.length === 0) return; // pode ser evento de status (entregue/lido)

  let people: Person[];
  let tasks: Task[];
  let messages: MessageRow[];
  try {
    [people, tasks, messages] = await Promise.all([loadPeople(), loadTasks(), loadMessages()]);
  } catch (err) {
    logger.error('Falha ao carregar planilha no webhook', { error: (err as Error).message });
    return;
  }

  const seenIds = new Set(messages.map((m) => m.message_id).filter(Boolean));
  for (const msg of incoming) {
    try {
      await handleOneMessage(msg, people, tasks, seenIds);
    } catch (err) {
      logger.error('Erro ao tratar mensagem recebida', { error: (err as Error).message });
    }
  }
}

async function safeAppend(row: MessageRow): Promise<void> {
  try {
    await appendMessage(row);
  } catch (err) {
    logger.error('Falha ao registrar mensagem na planilha', { error: (err as Error).message });
  }
}

function invalidHint(r: ResolveResult): string {
  if (r.invalidNumbers.length > 0) {
    return `Os números ou a descrição ${r.invalidNumbers.join(', ')} não existem na lista de hoje.`;
  }
  return '';
}

function buildDoneReply(nome: string, r: ResolveResult, remaining: Task[]): string {
  const doneDesc = r.targets.map((t) => `“${t.descricao}”`).join(', ');
  const parts: string[] = [];
  if (r.markedAll) {
    parts.push(
      `Você enviou apenas "feito" e havia mais de uma tarefa pendente. Marquei TODAS como concluídas: ${doneDesc}.`,
    );
  } else {
    parts.push(`Perfeito! Marquei como concluída: ${doneDesc}.`);
  }
  if (r.invalidNumbers.length > 0) {
    parts.push(`Obs.: os números ${r.invalidNumbers.join(', ')} não existem na lista de hoje.`);
  }
  parts.push(
    remaining.length
      ? `Ainda faltam:\n${formatTaskListMultiline(remaining)}`
      : 'É isso por hoje, tudo concluído!',
  );
  return parts.join('\n\n');
}

async function handleOneMessage(
  msg: IncomingMessage,
  people: Person[],
  tasks: Task[],
  seenIds: Set<string>,
): Promise<void> {
  // Dedup de reentregas da Meta.
  if (msg.id && seenIds.has(msg.id)) {
    logger.info(`Mensagem ${msg.id} já processada, ignorando reentrega.`);
    return;
  }
  if (msg.id) seenIds.add(msg.id);

  const text = msg.type === 'text' ? (msg.text?.body ?? '') : '';
  const phone = msg.from;
  const person = findPersonByPhone(people, phone);
  const inboundRow = buildInboundRow(msg, person);

  // 3) Número não cadastrado.
  if (!person) {
    inboundRow.parsed_intent = 'unknown_number';
    await safeAppend(inboundRow);
    const reply =
      'Olá! Este número não está cadastrado para receber lembretes de tarefas. Fale com o Pituxo para ser incluído.';
    const r = await sendText(phone, reply);
    await safeAppend(buildOutboundRow(phone, '', reply, 'unknown_number', '', r));
    return;
  }

  if (msg.type !== 'text') {
    inboundRow.parsed_intent = 'nao_texto';
    await safeAppend(inboundRow);
    const reply = 'Por enquanto eu entendo apenas mensagens de texto. Envie "ajuda" para ver os comandos.';
    const r = await sendText(person.whatsapp_e164, reply);
    await safeAppend(buildOutboundRow(person.whatsapp_e164, person.person_id, reply, 'help', '', r));
    return;
  }

  const intent = parseMessage(text);
  inboundRow.parsed_intent = intent.type;
  if (intent.type === 'admin') inboundRow.body = 'admin [REDACTED]';

  const tz = person.timezone || env.DEFAULT_TIMEZONE;
  const today = localDate(tz);
  const pending = getPendingTasksForToday(tasks, person.person_id, today);

  let reply = '';
  let relatedKey = '';
  const changed: Task[] = [];

  switch (intent.type) {
    case 'help':
      reply = formatHelpText();
      break;

    case 'status':
      reply = formatStatusText(person.nome, pending);
      break;

    case 'done': {
      ({ reply, relatedKey } = handleDone(intent, pending, person, today, changed, relatedKey, tasks));
      break;
    }

    case 'skip': {
      ({ reply, relatedKey } = handleSkip(intent, pending, person, today, changed, relatedKey, tasks));
      break;
    }

    case 'admin': {
      const admins = env.ADMIN_PHONES.split(',').map((s) => brPhoneKey(s)).filter(Boolean);
      if (!admins.includes(brPhoneKey(phone))) {
        reply = 'Não entendi. Envie "ajuda" para ver os comandos disponíveis.';
        break;
      }
      const tk = intent.raw.trim().split(/\s+/);
      if (!env.ADMIN_PASSWORD || tk[1] !== env.ADMIN_PASSWORD) {
        reply = 'Senha de admin incorreta.';
        break;
      }
      const sub = (tk[2] ?? '').toLowerCase();

      if (sub === 'add') {
        reply = await handleAdminAdd(tk, people, tasks, today);
        break;
      }

      if (sub === 'remove') {
        reply = await handleAdminRemove(tk, people, tasks);
        break;
      }

      if (sub === 'list') {
        reply = handleAdminList(tk, people, tasks);
        break;
      }

      reply = 'Subcomandos: add, remove, list.';
      break;
    }

    default:
      reply = 'Não entendi. Envie "ajuda" para ver os comandos disponíveis.';
  }

  if (changed.length) {
    try {
      await saveTasks(dedupeByRow(changed));
    } catch (err) {
      logger.error('Falha ao salvar tarefas após comando', { error: (err as Error).message });
    }
  }

  await safeAppend(inboundRow);
  const sendResult = await sendText(person.whatsapp_e164, reply);
  await safeAppend(buildOutboundRow(person.whatsapp_e164, person.person_id, reply, intent.type, relatedKey, sendResult));
}

async function handleAdminAdd(
  tokens: string[],
  people: Person[],
  tasks: Task[],
  today: string,
): Promise<string> {
  let reply: string;
  const targetNameOrId = tokens[3] ?? '';
  const per = (tokens[4] ?? '').toLowerCase();
  const descricao = tokens.slice(5).join(' ');
  if (!targetNameOrId || !descricao || !['daily', 'weekly', 'once'].includes(per)) {
    return reply = 'Uso: admin SENHA add <person_id> <daily|weekly|once> <descrição>';
  }
  const { match: pMatch, ambiguous: pAmbiguous } = findPersonByIdOrName(people,targetNameOrId);
  if (pAmbiguous.length > 0) {
    return reply = `O nome "${targetNameOrId}" está ambiguo. Tente escrever mais precisamente ou digitar o pId do usuário.`;
  }
  if (!pMatch) {
    return reply = `person_id ou person_name "${targetNameOrId}" não foi encontrado.`;
  }
  const targetId = pMatch.person_id;
  const maxNum = tasks.reduce((m, t) => {
    const mm = /^t(\d+)$/.exec(t.task_id);
    return mm ? Math.max(m, parseInt(mm[1], 10)) : m;
  }, 0);
  const newId = 't' + String(maxNum + 1).padStart(3, '0');
  const newTask: Task = {
    __row: 0, task_id: newId, person_id: targetId, descricao,
    data: today, status: 'pending', periodicidade: per as any,
    cobrar: true, last_reminder_at: '', completed_at: '', skip_until: '', observacoes: '',
  };
  try {
    await appendTask(newTask);
    return reply = `Tarefa criada: ${newId} → ${pMatch.nome} — "${descricao}" (${per}).`;
  } catch {
    return reply = 'Falha ao criar a tarefa. Veja os logs.';
  }
}

async function handleAdminRemove(
  tokens: string[],
  people: Person[],
  tasks: Task[],
): Promise<string>{
  const targetNameOrId = tokens[3] ?? '';
  const ref = tokens.slice(4).join(' ');
  let reply: string;
  if (!targetNameOrId || !ref) {
  return reply = 'Uso: admin SENHA remove <person_id> <task_id ou descrição>';
  }
  const { match: pMatch, ambiguous: pAmbiguous } = findPersonByIdOrName(people, targetNameOrId);
  if (pAmbiguous.length > 0) {
  return reply = `O nome "${targetNameOrId}" está ambiguo. Tente escrever mais precisamente ou digitar o pId do usuário.`;
  }
  if (!pMatch) {
  return reply = `person_id ou person_name "${targetNameOrId}" não foi encontrado.`;
  }
  const targetId = pMatch.person_id;
  const targetName = pMatch.nome;
  const personTasks = tasks.filter((t) => t.person_id === targetId);
  if (personTasks.length === 0) {
  return reply = `Nenhuma tarefa encontrada para ${targetName}.`;
  }
  let target = personTasks.find((t) => t.task_id === ref);
  if (!target) {
  const { match, ambiguous } = findTaskByDescription(personTasks, ref);
  if (ambiguous.length > 0) {
    return reply = [
      'Mais de uma tarefa parecida:', '',
      formatTaskListMultiline(ambiguous), '',
      'Remova pelo task_id para evitar ambiguidade.',
    ].join('\n');
  }
  target = match;
  }
  if (!target) {
  return reply = `Não encontrei a tarefa "${ref}" para ${targetNameOrId}.`;
  }
  try {
  await deleteTaskById(target.task_id);
  return reply = `Tarefa removida: ${target.task_id} — "${target.descricao}" (${targetName}).`;
  } catch {
  return reply = 'Falha ao remover a tarefa. Veja os logs.';
  }
}

function handleAdminList(
  tokens: string[],
  people: Person[],
  tasks: Task[],
): string{
  let nameOf = '';
  let idOf = '';
  const targetNameOrId = tokens[3] ?? '';
  const { match, ambiguous } = findPersonByIdOrName(people, targetNameOrId);
  const nameFromPid = (pid: string) => people.find((p) => p.person_id === pid)?.nome || pid;
  if (targetNameOrId) {
    if (ambiguous.length > 0) return 'Nome ambíguo. Tente digitar mais precisamente ou o pId.';
    if (!match) return `person_id ou person_name "${targetNameOrId}" não encontrado.`;
  nameOf = match.nome;
  idOf = match.person_id;
  }
  const aberta = (t: Task) => t.status !== 'done';
  const sel = (targetNameOrId ? tasks.filter((t) => t.person_id === idOf) : tasks)
  .filter(aberta)
  .sort((a, b) =>
    a.person_id === b.person_id
      ? a.task_id.localeCompare(b.task_id)
      : a.person_id.localeCompare(b.person_id),
  );
  if (sel.length === 0) {
  return targetNameOrId ? `Nenhuma tarefa em aberto para ${nameOf}.` : 'Nenhuma tarefa em aberto.';
  }
  return sel.map((t) => `${t.task_id} [${nameFromPid(t.person_id)}] ${t.descricao} (${t.status}, ${t.periodicidade})`)
  .join('\n');
}

function handleDone(
  intent: Extract<Intent, {type: 'done' | 'skip'}>,
  pending: Task[],
  person: Person,
  today: string,
  changed: Task[],
  relatedKey: string,
  tasks: Task[]
): { reply: string, relatedKey: string } {
  const r = resolveTargets(intent, pending);
  if (r.emptyList) {
  return { reply: `Você não tem tarefas pendentes hoje, ${person.nome}.`, relatedKey };
  }
  if (r.ambiguous.length > 0) {
    return {reply: [
      'Encontrei mais de uma tarefa parecida. Qual delas?',
      '',
      formatTaskListMultiline(r.ambiguous),
      '',
      'Responda com o número (ex.: "feito 1").',
    ].join('\n'), relatedKey};
  }
  if (r.targets.length === 0) {
    return { reply: `Não encontrei essa tarefa. ${invalidHint(r)} Envie "status" para ver a lista ou "ajuda".`.trim(), relatedKey };
  }
  const stamp = nowIso();
  for (const t of r.targets) {
    markDone(t, stamp);
    changed.push(t);
  }
  relatedKey = r.targets.map((t) => t.task_id).join(',');
  const remaining = getPendingTasksForToday(tasks, person.person_id, today);
  return { reply: buildDoneReply(person.nome, r, remaining), relatedKey };
}

function handleSkip(
  intent: Extract<Intent, {type: 'done' | 'skip'}>,
  pending: Task[],
  person: Person,
  today: string,
  changed: Task[],
  relatedKey: string,
  tasks: Task[]
): { reply: string, relatedKey: string}{
  const r = resolveTargets(intent, pending);
  if (r.emptyList) {
    return { reply:`Você não tem tarefas pendentes hoje, ${person.nome}.`, relatedKey};
  }
  if (r.ambiguous.length > 0) {
    return {reply: [
      'Mais de uma tarefa parecida. Qual você quer pular?',
      '',
      formatTaskListMultiline(r.ambiguous),
      '',
      'Responda com o número (ex.: "pular 1").',
    ].join('\n'), relatedKey};
  }
  if (r.targets.length === 0) {
    return {reply: `Não encontrei essa tarefa para pular. ${invalidHint(r)} Envie "status" ou "ajuda".`.trim(), relatedKey};
  }
  for (const t of r.targets) {
    markSkippedForToday(t, today);
    changed.push(t);
  }
  relatedKey = r.targets.map((t) => t.task_id).join(',');
  const remaining = getPendingTasksForToday(tasks, person.person_id, today);
  const skippedDesc = r.targets.map((t) => `“${t.descricao}”`).join(', ');
  return {reply: [
    `Ok, pulei por hoje: ${skippedDesc}.`,
    remaining.length
      ? `Ainda faltam:\n${formatTaskListMultiline(remaining)}`
      : 'Nada mais pendente por hoje.',
  ].join('\n\n'), relatedKey};
}