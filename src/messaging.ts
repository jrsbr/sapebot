import type { Task, Person, MessageRow, SendResult } from './types';
import { nowIso } from './time';

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

