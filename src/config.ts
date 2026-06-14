import dotenv from 'dotenv';
import { z } from 'zod';
import { logger } from './logger';

dotenv.config();

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),

  // ===== WhatsApp Cloud API (Meta) =====
  META_WHATSAPP_TOKEN: z.string().min(1, 'META_WHATSAPP_TOKEN é obrigatório'),
  META_PHONE_NUMBER_ID: z.string().min(1, 'META_PHONE_NUMBER_ID é obrigatório'),
  META_VERIFY_TOKEN: z.string().min(1, 'META_VERIFY_TOKEN é obrigatório'),
  // Opcional: usado para validar a assinatura X-Hub-Signature-256 do webhook.
  META_APP_SECRET: z.string(),
  // Versão da Graph API. Pode mudar com o tempo; veja README.
  GRAPH_API_VERSION: z.string().default('v20.0'),

  // ===== Google Sheets =====
  GOOGLE_SHEETS_SPREADSHEET_ID: z.string().min(1, 'GOOGLE_SHEETS_SPREADSHEET_ID é obrigatório'),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().email('GOOGLE_SERVICE_ACCOUNT_EMAIL inválido'),
  // A chave costuma vir com "\n" escapado quando colocada em uma única linha no .env.
  GOOGLE_PRIVATE_KEY: z
    .string()
    .min(1, 'GOOGLE_PRIVATE_KEY é obrigatório')
    .transform((k) => k.replace(/\\n/g, '\n')),

  // ===== Agendamento =====
  DEFAULT_TIMEZONE: z.string().default('America/Sao_Paulo'),
  REMINDER_HOUR: z.coerce.number().int().min(0).max(23).default(9),
  REMINDER_MINUTE: z.coerce.number().int().min(0).max(59).default(0),
  REMINDER_HOUR_2: z.coerce.number().int().min(0).max(23).default(21),
  REMINDER_MINUTE_2: z.coerce.number().int().min(0).max(59).default(0),

  // ===== Templates aprovados na Meta =====
  WHATSAPP_TEMPLATE_TASKS: z.string().default('lembrete_tarefas'),
  WHATSAPP_TEMPLATE_NO_TASKS: z.string().default('sem_tarefas'),
  // Código de idioma dos templates conforme cadastrado na Meta (ex.: pt_BR).
  WHATSAPP_TEMPLATE_LANG: z.string().default('pt_BR'),

    // ===== Admin via WhatsApp =====
  ADMIN_PHONES: z.string().default(''), // E.164 separados por vírgula
});

export type AppConfig = z.infer<typeof schema>;

function load(): AppConfig {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // O zod reporta apenas os caminhos/campos com erro, nunca os valores.
    logger.error('Falha ao validar variáveis de ambiente:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}

export const env = load();