import { describe, it, expect } from 'vitest';
import {
  Task, MessageRow,
  getPendingTasksForToday, rolloverRecurringTasks, markDone, markSkippedForToday,
  resolveTargets, reminderTaskKey, alreadyRemindedToday,
} from '../src/tasks';

function makeTask(p: Partial<Task>): Task {
  return {
    __row: 2,
    task_id: 't1',
    person_id: 'p1',
    descricao: 'Lavar a louça',
    data: '2026-06-01',
    status: 'pending',
    periodicidade: 'daily',
    cobrar: true,
    last_reminder_at: '',
    completed_at: '',
    skip_until: '',
    observacoes: '',
    ...p,
  };
}

describe('getPendingTasksForToday (busca de tarefas pendentes)', () => {
  const today = '2026-06-01';

  it('retorna apenas pendentes, cobráveis, não pausadas e devidas', () => {
    const tasks: Task[] = [
      makeTask({ task_id: 't1' }),
      makeTask({ task_id: 't2', status: 'done', cobrar: false }),
      makeTask({ task_id: 't3', cobrar: false }),
      makeTask({ task_id: 't4', skip_until: '2026-06-01' }), // pausada hoje
      makeTask({ task_id: 't5', person_id: 'p2' }), // outra pessoa
      makeTask({ task_id: 't6', data: '2026-06-02' }), // ainda não devida
    ];
    const r = getPendingTasksForToday(tasks, 'p1', today);
    expect(r.map((t) => t.task_id)).toEqual(['t1']);
  });

  it('ordena de forma determinística por task_id', () => {
    const tasks: Task[] = [
      makeTask({ task_id: 't003' }),
      makeTask({ task_id: 't001' }),
      makeTask({ task_id: 't002' }),
    ];
    const r = getPendingTasksForToday(tasks, 'p1', today);
    expect(r.map((t) => t.task_id)).toEqual(['t001', 't002', 't003']);
  });
});

describe('markDone / markSkippedForToday (marcação de tarefa)', () => {
  it('marcar como feita ajusta status, completed_at e cobrar', () => {
    const t = makeTask({});
    markDone(t, '2026-06-01T12:00:00.000Z');
    expect(t.status).toBe('done');
    expect(t.cobrar).toBe(false);
    expect(t.completed_at).toBe('2026-06-01T12:00:00.000Z');
  });

  it('pular ajusta status, skip_until e cobrar', () => {
    const t = makeTask({});
    markSkippedForToday(t, '2026-06-01');
    expect(t.status).toBe('skipped');
    expect(t.skip_until).toBe('2026-06-01');
    expect(t.cobrar).toBe(false);
  });
});

describe('resolveTargets', () => {
  const pending = [
    makeTask({ task_id: 't1', descricao: 'Lavar a louça' }),
    makeTask({ task_id: 't2', descricao: 'Tirar o lixo' }),
  ];

  it('"feito" simples com várias marca todas (markedAll)', () => {
    const r = resolveTargets({ type: 'done' }, pending);
    expect(r.markedAll).toBe(true);
    expect(r.targets).toHaveLength(2);
  });

  it('"feito" simples com uma marca a única', () => {
    const r = resolveTargets({ type: 'done' }, [pending[0]]);
    expect(r.markedAll).toBe(false);
    expect(r.targets.map((t) => t.task_id)).toEqual(['t1']);
  });

  it('índices válidos e inválidos', () => {
    const r = resolveTargets({ type: 'done', indices: [1, 5] }, pending);
    expect(r.targets.map((t) => t.task_id)).toEqual(['t1']);
    expect(r.invalidNumbers).toEqual([5]);
  });

  it('texto encontra por descrição', () => {
    const r = resolveTargets({ type: 'done', query: 'louca' }, pending);
    expect(r.targets.map((t) => t.task_id)).toEqual(['t1']);
  });

  it('lista vazia sinaliza emptyList', () => {
    const r = resolveTargets({ type: 'done' }, []);
    expect(r.emptyList).toBe(true);
  });
});

describe('rolloverRecurringTasks', () => {
  it('reinicia tarefa diária concluída em dia anterior', () => {
    const t = makeTask({ data: '2026-05-31', status: 'done', cobrar: false, completed_at: 'x' });
    const changed = rolloverRecurringTasks([t], '2026-06-01');
    expect(changed).toHaveLength(1);
    expect(t.status).toBe('pending');
    expect(t.cobrar).toBe(true);
    expect(t.data).toBe('2026-06-01');
    expect(t.completed_at).toBe('');
  });

  it('não reinicia tarefa "once"', () => {
    const t = makeTask({ data: '2026-05-31', status: 'done', cobrar: false, periodicidade: 'once' });
    expect(rolloverRecurringTasks([t], '2026-06-01')).toHaveLength(0);
    expect(t.status).toBe('done');
  });

  it('semanal só reinicia após 7 dias', () => {
    const t = makeTask({ data: '2026-05-30', status: 'done', periodicidade: 'weekly' });
    expect(rolloverRecurringTasks([t], '2026-06-01')).toHaveLength(0); // 2 dias
    const t2 = makeTask({ data: '2026-05-25', status: 'done', periodicidade: 'weekly' });
    expect(rolloverRecurringTasks([t2], '2026-06-01')).toHaveLength(1); // 7 dias
  });
});

describe('alreadyRemindedToday (prevenção de envio duplicado)', () => {
  const tz = 'America/Sao_Paulo';
  const pending = [makeTask({ task_id: 't1' }), makeTask({ task_id: 't2' })];
  const key = reminderTaskKey(pending);

  const baseMsg = (over: Partial<MessageRow>): MessageRow => ({
    message_id: 'm1',
    timestamp: '2026-06-01T12:00:00.000Z', // 09:00 em São Paulo
    direction: 'outbound',
    person_id: 'p1',
    whatsapp_e164: '+5582999999999',
    body: '...',
    parsed_intent: 'reminder',
    related_task_id: key,
    status: 'sent',
    ...over,
  });

  it('detecta lembrete já enviado hoje para a mesma lista', () => {
    expect(alreadyRemindedToday([baseMsg({})], 'p1', '2026-06-01', key, tz)).toBe(true);
  });

  it('não bloqueia se a lista de tarefas mudou', () => {
    const msgs = [baseMsg({ related_task_id: 't1' })];
    expect(alreadyRemindedToday(msgs, 'p1', '2026-06-01', key, tz)).toBe(false);
  });

  it('não bloqueia se o lembrete foi em outro dia', () => {
    const msgs = [baseMsg({ timestamp: '2026-05-31T12:00:00.000Z' })];
    expect(alreadyRemindedToday(msgs, 'p1', '2026-06-01', key, tz)).toBe(false);
  });

  it('reminderTaskKey é estável independente da ordem', () => {
    const a = reminderTaskKey([makeTask({ task_id: 't2' }), makeTask({ task_id: 't1' })]);
    const b = reminderTaskKey([makeTask({ task_id: 't1' }), makeTask({ task_id: 't2' })]);
    expect(a).toBe(b);
    expect(a).toBe('t1,t2');
  });
});