// ===== Tipos do domínio =====

export type TaskStatus = 'pending' | 'done' | 'skipped' | 'cancelled';
export type Periodicidade = 'daily' | 'weekly' | 'once';
export type AutoTaskStatus = 'done' | 'missed' | 'pending';
export type TaskKind = 'normal' | 'auto';
export type FlagSpec = Record<string, { kind: 'bool'| 'value' | 'multi' }>;

export interface Person {
  __row: number;
  person_id: string;
  nome: string;
  whatsapp_e164: string;
  ativo: boolean;
  opt_in: boolean;
  timezone: string;
  observacoes: string;
  ferias: boolean;
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
  grupo: string;
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

export interface IncomingMessage {
  from: string; // wa_id (apenas dígitos)
  id: string;
  type: string;
  text?: { body: string };
}

export interface AutoTask {
  __row: number;
  task_id: string;
  descricao: string;
}

export interface Designation {
  __row: number;
  task_id: string;
  person_id: string;
  count: number;
}

export interface Designated {
  __row?: number;
  data: string;
  task_id: string;
  person_id: string;
  status: AutoTaskStatus;
}

export interface GenericTaskBase {
  __row?: number,
  task_id: string;
  descricao: string;
  data: string;
  person_id: string;
}
export type GenericTask =
| (GenericTaskBase & { kind: 'normal'; status: TaskStatus })
| (GenericTaskBase & { kind: 'auto'; status: AutoTaskStatus });

export type Intent =
  | { type: 'done'; indices?: number[]; query?: string }
  | { type: 'skip'; indices?: number[]; query?: string }
  | { type: 'status' }
  | { type: 'help' }
  | { type: 'unknown'; raw: string }
  | { type: 'admin'; raw: string }
  | { type: 'ferias_on' }
  | { type: 'ferias_off' }
  | { type: 'calendar'}
  | { type: 'bomdia' }
  | { type: 'confirm' }
  | { type: 'cancel' };
  
export interface ResolveResult {
  targets: GenericTask[];
  invalidNumbers: number[];
  ambiguous: GenericTask[];
  markedAll: boolean;
  emptyList: boolean;
}

export type AdminError =
  | 'unclosed_quote'
  | 'unknown_flag'
  | 'missing_value'
  | 'unknown_subcommand'
  | 'missing_description'
  | 'missing_target'
  | 'target_conflict'
  | 'periodicity_conflict'
  | 'missing_periodicity'
  | 'invalid_date'
  | 'duplicate_flag';

export interface AdminAdd {
  sub: 'add';
  pessoas: string[];
  descricao: string;
  periodicidade: Periodicidade;
  grupo: string;
  data: string;
}

export interface AdminRemove {
  sub: 'remove';
  targetKind: 'person' | 'group';
  target: string;
  descricao: string;
}

export interface AdminList {
  sub: 'list';
  pessoa?: string;
  grupo?: string;
}

export interface AdminReport {
  sub: 'report';
  pessoa?: string;
}

export type AdminCommand = AdminAdd | AdminRemove | AdminList | AdminReport;