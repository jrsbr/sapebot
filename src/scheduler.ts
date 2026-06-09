// Rotina diária de disparo de lembretes.
import cron from 'node-cron';
import { env } from './config';
import { logger } from './logger';
import { nowIso, localDate, logicalDate } from './time';
import {
  loadPeople, loadTasks, loadConfig, loadMessages, saveTasks, appendMessages, dumpTab,
  loadDesignated, saveDesignated, TAB, overwriteTab
} from './sheets';
import {
  getPendingTasksForToday, rolloverRecurringTasks,
  reminderTaskKey, alreadyRemindedToday, dedupeByRow
} from './tasks';
import { sendText, sendTemplate } from './whatsapp';
import { formatReminderText, formatNoTasksText, formatTaskListSingleLine, buildOutboundRow, within24h } from './messaging';
import type { Person, Task, MessageRow, SendResult } from './types'
import { expiredPendingDesignated } from './autotask';

function configFlag(cfg: Record<string, string>, key: string, def: boolean): boolean {
  const v = cfg[key];
  if (v == null) return def;
  const s = v.trim().toUpperCase();
  return s === 'TRUE' || s === '1' || s === 'SIM';
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

export async function runDailyReminders(slot = 'manha'): Promise<void> {
  logger.info('Iniciando rotina diária de lembretes');

  let people: Person[];
  let tasks: Task[];
  let cfg: Record<string, string>;
  let messages: MessageRow[];
  try {
    [people, tasks, cfg, messages] = await Promise.all([
      loadPeople(), loadTasks(), loadConfig(), loadMessages(),
    ]);
  } catch (err) {
    logger.error('Não foi possível carregar dados da planilha. Abortando rotina.', {
      error: (err as Error).message,
    });
    return;
  }

  if (!configFlag(cfg, 'daily_reminder_enabled', true)) {
    logger.info('daily_reminder_enabled=FALSE na aba Config. Nenhuma mensagem será enviada.');
    return;
  }
  const sendNoTask = configFlag(cfg, 'send_no_task_message', false);

  // 1) Virada de recorrentes (daily/weekly) para hoje, no fuso padrão.
  const todayDefault = localDate(env.DEFAULT_TIMEZONE);
  const rolled = rolloverRecurringTasks(tasks, todayDefault);
  if (rolled.length > 0) {
    try {
      await saveTasks(rolled);
      logger.info(`Tarefas recorrentes reiniciadas para hoje: ${rolled.length}`);
    } catch (err) {
      logger.error('Falha ao salvar virada de tarefas recorrentes', {
        error: (err as Error).message,
      });
    }
  }

  const tasksToUpdate: Task[] = [];
  const messagesToLog: MessageRow[] = [];
  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const person of people) {
    if (!person.ativo || !person.opt_in) continue;
    const tz = person.timezone || env.DEFAULT_TIMEZONE;
    const today = localDate(tz);
    const pending = getPendingTasksForToday(tasks, person.person_id, today);

    // 4) Sem tarefas: só envia se configurado.
    if (pending.length === 0) {
      if (!sendNoTask || slot !== 'manha') continue;
      const key = `${slot}:no-tasks`;
      if (alreadyRemindedToday(messages.concat(messagesToLog), person.person_id, today, key, tz)) {
        skipped++;
        continue;
      }
      const result = within24h(messages, person.person_id)
        ? await sendText(person.whatsapp_e164, formatNoTasksText(person.nome))
        : await sendTemplate(person.whatsapp_e164, env.WHATSAPP_TEMPLATE_NO_TASKS, [
            { type: 'text', text: person.nome },
          ]);
      messagesToLog.push(buildOutboundRow(person.whatsapp_e164,person.person_id, `[sem tarefas] ${person.nome}`, 'reminder', key, result));
      result.ok ? sent++ : errors++;
      continue;
    }

    // 5) Idempotência: mesma lista no mesmo dia não reenvia.
    const key = `${slot}:${reminderTaskKey(pending)}`;
    if (alreadyRemindedToday(messages.concat(messagesToLog), person.person_id, today, key, tz)) {
      logger.info(`Lembrete já enviado hoje para ${person.person_id}, pulando.`);
      skipped++;
      continue;
    }

    // 3) Envia: texto livre se dentro da janela de 24h; senão, template.
    let result: SendResult;
    let bodyForLog: string;
    if (within24h(messages, person.person_id)) {
      bodyForLog = formatReminderText(person.nome, pending);
      result = await sendText(person.whatsapp_e164, bodyForLog);
    } else {
      const list = formatTaskListSingleLine(pending);
      bodyForLog = `[template:${env.WHATSAPP_TEMPLATE_TASKS}] nome=${person.nome} tarefas=${list}`;
      result = await sendTemplate(person.whatsapp_e164, env.WHATSAPP_TEMPLATE_TASKS, [
        { type: 'text', text: person.nome },
        { type: 'text', text: list },
      ]);
    }

    messagesToLog.push(buildOutboundRow(person.whatsapp_e164,person.person_id, bodyForLog, 'reminder', key, result));

    if (result.ok) {
      sent++;
      // 7) Atualiza last_reminder_at nas tarefas cobradas.
      const stamp = nowIso();
      for (const t of pending) {
        t.last_reminder_at = stamp;
        tasksToUpdate.push(t);
      }
    } else {
      errors++;
      logger.warn(`Falha ao enviar lembrete para ${person.person_id}`, { error: result.error });
    }
  }

  // Persiste atualizações em lote.
  try {
    if (tasksToUpdate.length) await saveTasks(dedupeByRow(tasksToUpdate));
  } catch (err) {
    logger.error('Falha ao atualizar last_reminder_at', { error: (err as Error).message });
  }
  try {
    if (messagesToLog.length) await appendMessages(messagesToLog);
  } catch (err) {
    logger.error('Falha ao registrar mensagens enviadas', { error: (err as Error).message });
  }

  logger.info(`Rotina concluída. Enviados=${sent} Pulados=${skipped} Erros=${errors}`);
}

export async function runMissedDesignated(): Promise<void> {
  try {
    const designated = await loadDesignated();
    const logicDay = logicalDate(env.DEFAULT_TIMEZONE);
    const newMissed = expiredPendingDesignated(designated, logicDay);
    for (const d of newMissed) {
      d.status = 'missed';
      await saveDesignated(d);
    }
    logger.info(`Designações marcadas como missed: ${newMissed.length}`);
  } catch (err) {
    logger.error('Falha ao fechar designações pendentes', { error: (err as Error).message });
  }
}


export function startScheduler(): void {
  const schedule = (hour: number, minute: number, slot: string) => {
    const expr = `${minute} ${hour} * * *`;
    if (!cron.validate(expr)) {
      logger.error(`Expressão cron inválida: "${expr}"`);
      return;
    }
    cron.schedule(
      expr,
      () => {
        runDailyReminders(slot).catch((err) =>
          logger.error('Erro não tratado na rotina diária', { error: (err as Error).message }),
        );
      },
      { timezone: env.DEFAULT_TIMEZONE },
    );
    
    const hh = String(hour).padStart(2, '0');
    const mm = String(minute).padStart(2, '0');
    logger.info(`Agendador ativo (${slot}): todos os dias às ${hh}:${mm} (${env.DEFAULT_TIMEZONE})`);
  };

  schedule(env.REMINDER_HOUR, env.REMINDER_MINUTE, 'manha');
  schedule(env.REMINDER_HOUR_2, env.REMINDER_MINUTE_2, 'noite');
  cron.schedule(
    '0 4 * * *',
    () => {
      purgeOldDoneOnceTasks(14)
        .then((n) => logger.info(`Tarefas once antigas removidas: ${n}.`))
        .catch((err) =>
          logger.error('Falha na limpeza de tarefas once', { error: (err as Error).message }),
        );
    },
    { timezone: env.DEFAULT_TIMEZONE },
  );

  // Limpeza diária da aba Mensagens (mantém só as últimas 48h).
  cron.schedule(
    '30 3 * * *',
    () => {
      pruneOldMessages(48)
        .then((n) => logger.info(`Limpeza de Mensagens: ${n} linhas removidas.`))
        .catch((err) =>
          logger.error('Falha na limpeza de Mensagens', { error: (err as Error).message }),
        );
    },
    { timezone: env.DEFAULT_TIMEZONE },
  );
}

// Permite rodar manualmente: `npm run send:now`
if (require.main === module) {
  runDailyReminders()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error('Falha ao executar rotina manual', { error: (err as Error).message });
      process.exit(1);
    });
}