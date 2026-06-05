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

export interface SendResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export interface TemplateParam {
  type: 'text';
  text: string;
}