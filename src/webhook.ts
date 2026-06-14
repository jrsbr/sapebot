// Rotas do webhook da Meta: verificação (GET) e recebimento de mensagens (POST).
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { env } from './config';
import { logger } from './logger';
import { nowIso, localDate, addDays, logicalDate, localHour } from './time';
import {
  loadPeople, loadTasks, loadMessages, loadAutoTasks, loadDesignated, saveTasks, appendMessage, appendTask, deleteTaskById, saveDesignated,
  deleteRows, TAB,
  savePerson, loadGMPhrases
} from './sheets';
import { parseMessage, normalizeText } from './parser';
import {
  findPersonByPhone, getPendingTasksForToday,
  markDone, markSkippedForToday, dedupeByRow,
  brPhoneKey, findPersonByIdOrName, linkedPendingTasks
} from './tasks';
import { formatStatusText, formatHelpText, formatTaskListMultiline, buildOutboundRow, buildInboundRow, formatMissedReport, formatWeekText, adminErrorMessage
 } from './messaging';
import { sendText, sendTemplate } from './whatsapp';
import { buildCombinedList, buildWeekCalendar, findTaskByDescription, resolveTargets, taskToGeneric } from './generictask';
import { runWeekGeneration } from './scheduler';
import { getPendingAutoForToday, missedInWindow, vacationPendingToDelete } from './autotask';
import type { Person, Task, MessageRow, IncomingMessage, ResolveResult, Intent, AutoTask, Designated, GenericTask, AdminAdd, AdminRemove, AdminList, AdminReport } from './types'
import { parseAdminCommand, tokenizeAdmin } from './adminparser';
import { askLlm } from './llm';

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
  if (!env.META_APP_SECRET) {
    logger.error('META_APP_SECRET não configurado; rejeitando webhook.');
    return false;
  }
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
  let autoTask: AutoTask[];
  let designated: Designated[];
  try {
    [people, tasks, messages, autoTask, designated] = await Promise.all([loadPeople(), loadTasks(), loadMessages(), loadAutoTasks(), loadDesignated()]);
  } catch (err) {
    logger.error('Falha ao carregar planilha no webhook', { error: (err as Error).message });
    return;
  }

  const seenIds = new Set(messages.map((m) => m.message_id).filter(Boolean));
  for (const msg of incoming) {
    try {
      await handleOneMessage(msg, people, tasks, autoTask, designated, seenIds);
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

function buildDoneReply(
    r: ResolveResult, 
    remaining: GenericTask[]
  ): string {
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
  autoTask: AutoTask[],
  designated: Designated[],
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
  const logicalToday = logicalDate(env.DEFAULT_TIMEZONE);

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

  const tz = person.timezone || env.DEFAULT_TIMEZONE;
  const today = localDate(tz);
  const pending = getPendingTasksForToday(tasks, person.person_id, today);
  const autoPending = getPendingAutoForToday(designated, person.person_id, logicalToday);
  const combined = buildCombinedList(pending, autoPending, autoTask);

  let reply = '';
  let relatedKey = '';
  let notices: GroupDoneNotice[] = [];
  const changed: Task[] = [];
  const autoChanged: Designated[] = [];
  let llmResponded = false;

  switch (intent.type) {
    case 'help':
      reply = formatHelpText();
      break;

    case 'status':
      reply = formatStatusText(person.nome, combined);
      break;

    case 'done': {
      ({ reply, relatedKey, notices } = handleDone(tasks, designated, autoTask, people, intent, combined, person, today, logicalToday, changed, autoChanged, relatedKey));
      break;
    }

    case 'skip': {
      ({ reply, relatedKey } = handleSkip(tasks, designated, autoTask, intent, combined, person, today, logicalToday, changed, autoChanged, relatedKey));
      break;
    }

    case 'ferias_on': {
      reply = handleFeriasOn(person);
      break;
    }
    
    case 'ferias_off': {
      reply = handleFeriasOff(person);
      break;
    }

    case 'ferias_on_confirm': {
      reply = await handleFeriasOnConfirm(person, designated);
      break;
    }

    case 'ferias_off_confirm': {
      reply = await handleFeriasOffConfirm(person);
      break;
    }

    case 'calendar': {
      reply = formatWeekText(person.nome, combined, buildWeekCalendar(tasks, designated, autoTask, person.person_id, today, logicalToday));
      break;
    }

    case 'bomdia': {
      const h = localHour(tz);
      if (h < 5) {
        reply = 'Ainda não é manhã... volte a dormir e me mande um "bom dia" depois das 5h.';
      } else if (h >= 14) {
        reply = 'Já não é mais manhã por aqui! Mas fica o desejo de uma boa tarde ou noite. ';
      } else {
        try {
          const frases = await loadGMPhrases();
          reply =
            frases.length > 0
              ? frases[Math.floor(Math.random() * frases.length)]
              : `Bom dia, ${person.nome}!`;
        } catch (err) {
          logger.error('Falha ao carregar frases de bom dia', { error: (err as Error).message });
          reply = `Bom dia, ${person.nome}!`;
        }
      }
      break;
    }

    case 'admin': {
      const admins = env.ADMIN_PHONES.split(',').map((s) => brPhoneKey(s)).filter(Boolean);
      if (!admins.includes(brPhoneKey(phone))) {
        reply = 'Não entendi. Envie "ajuda" para ver os comandos disponíveis.';
        break;
      }

      const tokens = tokenizeAdmin(intent.raw);
      if ('error' in tokens) {
        reply = adminErrorMessage(tokens.error); 
        break;
      }
      const command = parseAdminCommand(tokens.tokens);
      
      if ('error' in command) {
        reply = adminErrorMessage(command.error);
        break;
      }

      switch (command.sub) {
        case 'add': {
          reply = await handleAdminAdd(command, people, tasks, today);
          break;
        }

        case 'remove': {
          reply = await handleAdminRemove(command, people, tasks);
          break;
        }

        case 'list': {
          reply = handleAdminList(command, people, tasks);
          break;
        }
        
        case 'report': {
          reply = handleAdminReport(command, people, autoTask, designated, logicalToday);
          break;
        }
      }
      break;
    }

    default: {
      const geminiReply = await askLlm(text);
      llmResponded = geminiReply !== null;
      reply = geminiReply ?? 'Não entendi. Envie "ajuda" para ver os comandos disponíveis.';
    }
  }

  if (changed.length) {
    try {
      await saveTasks(dedupeByRow(changed));
    } catch (err) {
      logger.error('Falha ao salvar tarefas após comando', { error: (err as Error).message });
    }
  }

  if (autoChanged.length) {
    for (const d of autoChanged) {
      try { 
        await saveDesignated(d);
      } catch (err) {
        logger.error('Falha ao salvar auto tarefas após comando', { error: (err as Error).message });
      }
    }
  }

  for (const notice of notices) {
    if (!notice.person.ativo || !notice.person.opt_in) continue;
    const result = await sendTemplate(notice.person.whatsapp_e164, env.WHATSAPP_TEMPLATE_TASK_DONE_BY, [
      { type: 'text', text: notice.person.nome },
      { type: 'text', text: notice.descricao },
      { type: 'text', text: notice.doneBy },
    ]);
    const logBody = `[template:${env.WHATSAPP_TEMPLATE_TASK_DONE_BY}] nome=${notice.person.nome} tarefa=${notice.descricao} por=${notice.doneBy}`;
    await safeAppend(buildOutboundRow(notice.person.whatsapp_e164, notice.person.person_id, logBody, 'group_done_notice', '', result));
  }

  await safeAppend(inboundRow);
  const sendResult = await sendText(person.whatsapp_e164, reply);
  await safeAppend(buildOutboundRow(person.whatsapp_e164, person.person_id, reply, intent.type, llmResponded ? 'llm' : relatedKey, sendResult));
}

async function handleAdminAdd(
  command: AdminAdd,
  people: Person[],
  tasks: Task[],
  today: string,
): Promise<string> {
  const targets = [...new Set(command.pessoas)];
  const per = command.periodicidade
  const descricao = command.descricao;
  const notResolved: string[] = [];
  const targetPerson: Person[] = [];

  for (const pessoa of targets) {
    const { match: pMatch, ambiguous: pAmbiguous } = findPersonByIdOrName(people, pessoa);

    if (pAmbiguous.length > 0 || !pMatch) {
      notResolved.push(pessoa);
      continue;
    }
    targetPerson.push(pMatch);
  }

  if (notResolved.length > 0) return [
    `Não foi possível realizar a operação. Os nomes`,
    notResolved.join(', '),
    'estão ambíguos ou não foram encontrados. Tente os escrever novamente.'
  ].join(' ');

  let maxNum = tasks.reduce((m, t) => {
    const mm = /^t(\d+)$/.exec(t.task_id);
    return mm ? Math.max(m, parseInt(mm[1], 10)) : m;
  }, 0);

  const criadas: string[] = [];
  const alvos = [...new Map(targetPerson.map((p) => [p.person_id, p])).values()];
  try {
    for (const person of alvos) {
      maxNum++
      const newId = 't' + String(maxNum).padStart(3, '0');
      const newTask: Task = {
        __row: 0, 
        task_id: newId, 
        person_id: person.person_id, 
        descricao,
        data: command.data || today,    
        status: 'pending', 
        periodicidade: per,
        cobrar: true, 
        last_reminder_at: '', 
        completed_at: '', skip_until: '', 
        observacoes: '', 
        grupo: command.grupo,
      };
      await appendTask(newTask);
      criadas.push(`${newId} -> ${person.nome}`);
    }
  } catch {
    return `Falha ao criar tarefas. Criadas até falhar: ${criadas.join(', ') || 'nenhuma'}. Veja os logs.`;
  }
  const grupoMsg = command.grupo ? ` [grupo: ${command.grupo}]` : '';
return `Tarefa(s) criada(s) — "${descricao}" (${per})${grupoMsg}: ${criadas.join(', ')}.`;
}

async function handleAdminRemove(
  command: AdminRemove,
  people: Person[],
  tasks: Task[],
): Promise<string>{
  const targetNameOrId = command.target;
  const ref = command.descricao;

  if (command.targetKind === 'person') {
    const { match: pMatch, ambiguous: pAmbiguous } = findPersonByIdOrName(people, targetNameOrId);
    if (pAmbiguous.length > 0) {
      return `O nome "${targetNameOrId}" está ambiguo. Tente escrever mais precisamente ou digitar o pId do usuário.`;
    }
    if (!pMatch) {
      return `person_id ou person_name "${targetNameOrId}" não foi encontrado.`;
    }
    const targetId = pMatch.person_id;
    const targetName = pMatch.nome;
    const personTasks = tasks.filter((t) => t.person_id === targetId);
    if (personTasks.length === 0) {
      return `Nenhuma tarefa encontrada para ${targetName}.`;
    }
    const personGeneric = personTasks.map(taskToGeneric);
    let target = personTasks.find((t) => t.task_id === ref);
    if (!target) {
      const { match, ambiguous } = findTaskByDescription(personGeneric, ref);
      if (ambiguous.length > 0) {
        return [
          'Mais de uma tarefa parecida:', '',
          formatTaskListMultiline(ambiguous), '',
          'Remova pelo task_id para evitar ambiguidade.',
        ].join('\n');
      }
      if (match) {
        target = personTasks.find((t) => t.task_id === match.task_id);
      }
    }
    if (!target) {
      return `Não encontrei a tarefa "${ref}" para ${targetNameOrId}.`;
    }
    try {
    await deleteTaskById(target.task_id);
    return `Tarefa removida: ${target.task_id} — "${target.descricao}" (${targetName}).`;
    } catch {
    return 'Falha ao remover a tarefa. Veja os logs.';
    }
  }
  const groupTasks = tasks.filter((t) => t.grupo === targetNameOrId);
  if (groupTasks.length === 0) {
    return `Nenhuma tarefa encontrada no grupo "${targetNameOrId}".`;
  }
  const q = normalizeText(ref);
  const toRemove = groupTasks.filter((t) => t.task_id === ref || normalizeText(t.descricao) === q);
  if (toRemove.length === 0) {
    return `Não encontrei a tarefa "${ref}" no grupo "${targetNameOrId}".`;
  }
  try {
    for (const t of toRemove) await deleteTaskById(t.task_id);
    return `Removidas ${toRemove.length} tarefa(s) do grupo "${targetNameOrId}": "${toRemove[0].descricao}".`;
  } catch {
    return 'Falha ao remover as tarefas do grupo. Veja os logs.';
  }
}

function handleAdminList(
  command: AdminList,
  people: Person[],
  tasks: Task[],
): string{
  const nameFromPid = (pid: string) => people.find((p) => p.person_id === pid)?.nome || pid;
  const aberta = (t: Task) => t.status !== 'done';

  let sel: Task[];
  let emptyMsg: string;

  if (command.grupo) {
    sel = tasks.filter((t) => t.grupo === command.grupo);
    emptyMsg = `Nenhuma tarefa em aberto no grupo "${command.grupo}".`;
  } else if (command.pessoa) {
    const { match, ambiguous } = findPersonByIdOrName(people, command.pessoa);
    if (ambiguous.length > 0) return 'Nome ambíguo. Tente digitar mais precisamente ou o pId.';
    if (!match) return `person_id ou person_name "${command.pessoa}" não encontrado.`;
    sel = tasks.filter((t) => t.person_id === match.person_id);
    emptyMsg = `Nenhuma tarefa em aberto para ${match.nome}.`;
  } else {
    sel = tasks;
    emptyMsg = 'Nenhuma tarefa em aberto.';
  }

  const open = sel
    .filter(aberta)
    .sort((a, b) =>
      a.person_id === b.person_id
        ? a.task_id.localeCompare(b.task_id)
        : a.person_id.localeCompare(b.person_id),
    );
  if (open.length === 0) return emptyMsg;
  return open
    .map((t) => `${t.task_id} [${nameFromPid(t.person_id)}] ${t.descricao} (${t.status}, ${t.periodicidade})`)
    .join('\n');
}

interface GroupDoneNotice {
  person: Person;
  descricao: string;
  doneBy: string;
}

function handleDone(
  tasks: Task[],
  designated: Designated[],
  autoTasks: AutoTask[],
  people: Person[],
  intent: Extract<Intent, {type: 'done' | 'skip'}>,
  pending: GenericTask[],
  person: Person,
  today: string,
  logicalToday: string,
  changed: Task[],
  autoChanged: Designated[],
  relatedKey: string,
): { reply: string, relatedKey: string, notices: GroupDoneNotice[] } {
  const notices: GroupDoneNotice[] = [];
  const r = resolveTargets(intent, pending);
  if (r.emptyList) {
  return { reply: `Você não tem tarefas pendentes hoje, ${person.nome}.`, relatedKey, notices };
  }
  if (r.ambiguous.length > 0) {
    return {reply: [
      'Encontrei mais de uma tarefa parecida. Qual delas?',
      '',
      formatTaskListMultiline(r.ambiguous),
      '',
      'Responda com o número (ex.: "feito 1").',
    ].join('\n'), relatedKey, notices};
  }
  if (r.targets.length === 0) {
    return { reply: `Não encontrei essa tarefa. ${invalidHint(r)} Envie "status" para ver a lista ou "ajuda".`.trim(), relatedKey, notices };
  }
  const stamp = nowIso();
  for (const g of r.targets) {
    if (g.kind === 'normal') {
      const t = tasks.find((x) => x.__row === g.__row);
      if (t) {
        markDone(t, stamp);
        changed.push(t);
        for (const linked of linkedPendingTasks(tasks, t)) {
          markDone(linked, stamp);
          changed.push(linked);
          const owner = people.find((p) => p.person_id === linked.person_id);
          if (owner) notices.push({ person: owner, descricao: linked.descricao, doneBy: person.nome });
        }
      }
    } else {
        const d = designated.find((x) => x.__row === g.__row);
        if (d) {
          d.status = 'done';
          autoChanged.push(d);
        }
      }
    }
  relatedKey = r.targets.map((g) => g.task_id).join(',');
  const remaining = getPendingTasksForToday(tasks, person.person_id, today);
  const autoRemaining = getPendingAutoForToday(designated, person.person_id, logicalToday);
  const combined = buildCombinedList(remaining, autoRemaining, autoTasks);
  return { reply: buildDoneReply(r, combined), relatedKey, notices };
}

function handleSkip(
  tasks: Task[],
  designated: Designated[],
  autoTasks: AutoTask[],
  intent: Extract<Intent, {type: 'done' | 'skip'}>,
  pending: GenericTask[],
  person: Person,
  today: string,
  logicalToday: string,
  changed: Task[],
  autoChanged: Designated[],
  relatedKey: string,
): { reply: string, relatedKey: string} {
  const r = resolveTargets(intent, pending);
  if (r.emptyList) return { reply: `Você não tem tarefas pendentes hoje, ${person.nome}.`, relatedKey };

  if (r.ambiguous.length > 0) {
    return { reply: ['Mais de uma tarefa parecida. Qual você quer pular?', '', formatTaskListMultiline(r.ambiguous), '', 'Responda com o número (ex.: "pular 1").'].join('\n'), relatedKey };
  }

  if (r.targets.length === 0) {
    return { reply: `Não encontrei essa tarefa para pular. ${invalidHint(r)} Envie "status" ou "ajuda".`.trim(), relatedKey };
  }

  const normais = r.targets.filter((g) => g.kind === 'normal');
  const ignoredAuto = r.targets.filter((g) => g.kind === 'auto');

  if (normais.length === 0) {
    return { reply: 'A tarefa escolhida não pode ser pulada por ser automática (da casa).', relatedKey };
  }

  for (const g of normais) {
    const t = tasks.find((x) => x.__row === g.__row);
    if (t) { 
      markSkippedForToday(t, today); 
      changed.push(t); 
    }
  }
  relatedKey = normais.map((g) => g.task_id).join(',');

  const remaining = getPendingTasksForToday(tasks, person.person_id, today);
  const autoRemaining = getPendingAutoForToday(designated, person.person_id, logicalToday);
  const combined = buildCombinedList(remaining, autoRemaining, autoTasks);

  const skippedDesc = normais.map((g) => `“${g.descricao}”`).join(', ');
  const parts: string[] = [`Ok, pulei por hoje: ${skippedDesc}.`];
  if (ignoredAuto.length > 0) {
    const nomes = ignoredAuto.map((g) => `“${g.descricao}”`).join(', ');
    parts.push(`Obs.: ${nomes} não pode(m) ser pulada(s) (tarefa automática).`);
  }
  parts.push(combined.length ? `Ainda faltam:\n${formatTaskListMultiline(combined)}` : 'Nada mais pendente por hoje.');

  return { reply: parts.join('\n\n'), relatedKey };
}

function handleFeriasOn(
  person: Person
): string {
  if (person.ferias) return `Você já está de férias. Para sair de férias digite "voltar ferias".`;
  return 'Para confirmar a entrada de férias, digite "confirmar ferias". Essa ação tem consequências diretas na distribuição de tarefas da semana e não deve ser confirmada se não for intencional. Caso não deseje entrar de férias, basta ignorar essa mensagem.';
}

function handleFeriasOff(
  person: Person
): string {
  if (!person.ferias) return `Você não está de férias. Para entrar de férias digite "ferias".`;
  return 'Para confirmar o término de suas férias, digite "confirmar voltar ferias". Ao confirmar você voltará a receber tarefas automáticamente. Caso não deseje voltar de férias, basta ignorar essa mensagem.';
}

async function handleFeriasOnConfirm(
  person: Person,
  designated: Designated[],
): Promise<string> {
    const logicalToday = logicalDate(env.DEFAULT_TIMEZONE);
    const pendingToDelete = vacationPendingToDelete(designated, person.person_id, logicalToday);
    const rowsToDelete: number[] = [];
    for (const p of pendingToDelete) {
      if (p.__row !== undefined) rowsToDelete.push(p.__row);
    }

    try {
      person.ferias = true;
      await savePerson(person);
      await deleteRows(TAB.designado, rowsToDelete);
      await runWeekGeneration();
    } catch (err) {
      logger.error(`Ocorreu um erro ao ${person.person_id} tentar entrar de férias.`, {error : (err as Error).message});
      return 'Ocorreu um erro ao tentar entrar de férias. Digite "confirmar ferias" novamente. Caso um erro ocorra novamente, fale com o Pituxo para ajuda.';
    }
  return 'Você está oficialmente de férias! Vai aproveitar a vida e não esqueça de voltar de férias quando voltar à Sapecasa. Lembre-se que suas tarefas recorrentes pessoais continuam a ser cobradas. Caso você tenha feito isso por engano, por favor digite "confirmar voltar ferias" e contate o Pituxo.';
}

async function handleFeriasOffConfirm(
  person: Person,
): Promise<string> {
  person.ferias = false;
  try {
    await savePerson(person);
  } catch (err) {
      logger.error(`Ocorreu um erro ao ${person.person_id} tentar voltar de férias.`, {error : (err as Error).message});
      return 'Ocorreu um erro ao tentar voltar de férias. Digite "confirmar voltar ferias" novamente. Caso um erro ocorra novamente, fale com o Pituxo para ajuda.';
    }
  return 'Boas vindas de volta! A Sapecasa sentiu sua falta. Caso você tenha feito isso por engano, por favor digite "confirmar ferias" e volte para suas férias em paz.';
}

function handleAdminReport(
  command: AdminReport,
  people: Person[], 
  autoTask: AutoTask[], 
  designated: Designated[], 
  logicalToday: string,
): string {
  const cut = addDays(logicalToday, -7);
  let missedAutoTask = missedInWindow(designated, cut);
  if (command.pessoa) {
    const { match, ambiguous } = findPersonByIdOrName(people, command.pessoa);
    if (ambiguous.length > 0) {
      return `O nome "${command.pessoa}" está ambiguo. Tente escrever mais precisamente ou digitar o pId do usuário.`;
    }
    if (!match) {
      return `person_id ou person_name "${command.pessoa}" não foi encontrado.`;
    }
    missedAutoTask = missedAutoTask.filter((a) => a.person_id === match.person_id);
  }
  return formatMissedReport(missedAutoTask, people, autoTask);
}