// Envio pela WhatsApp Cloud API + fila serial com rate limit simples.
import axios, { AxiosError } from 'axios';
import { env } from './config';
import { logger } from './logger';
import { sleep } from './time';
import { onlyDigits } from './tasks';

const BASE_URL = `https://graph.facebook.com/${env.GRAPH_API_VERSION}/${env.META_PHONE_NUMBER_ID}/messages`;

export interface SendResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export interface TemplateParam {
  type: 'text';
  text: string;
}

// ===== Fila serial + rate limit =====
const MIN_INTERVAL_MS = 1000;
let lastSendAt = 0;
let chain: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = Math.max(0, lastSendAt + MIN_INTERVAL_MS - Date.now());
    if (wait > 0) await sleep(wait);
    lastSendAt = Date.now();
    return task();
  });
  // Mantém a cadeia viva mesmo após erros.
  chain = run.then(() => undefined, () => undefined);
  return run;
}

async function post(payload: Record<string, unknown>): Promise<SendResult> {
  try {
    const res = await axios.post(BASE_URL, payload, {
      headers: {
        Authorization: `Bearer ${env.META_WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      timeout: 15_000,
    });
    const id = res.data?.messages?.[0]?.id as string | undefined;
    return { ok: true, id };
  } catch (err) {
    const e = err as AxiosError<any>;
    const apiError = e.response?.data?.error;
    // Nunca logamos o token: apenas status e o erro retornado pela Meta.
    logger.error('Erro ao enviar mensagem no WhatsApp', {
      status: e.response?.status,
      code: apiError?.code,
      type: apiError?.type,
      message: apiError?.message,
    });
    return { ok: false, error: apiError?.message ?? e.message };
  }
}

function toRecipient(phone: string): string {
  // A Cloud API espera o número apenas com dígitos (E.164 sem o '+').
  return onlyDigits(phone);
}

export async function sendText(to: string, body: string): Promise<SendResult> {
  const recipient = toRecipient(to);
  if (!recipient) return { ok: false, error: 'telefone invalido' };
  return enqueue(() =>
    post({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'text',
      text: { preview_url: false, body },
    }),
  );
}

export async function sendTemplate(
  to: string,
  templateName: string,
  bodyParams: TemplateParam[],
  languageCode = env.WHATSAPP_TEMPLATE_LANG,
): Promise<SendResult> {
  const recipient = toRecipient(to);
  if (!recipient) return { ok: false, error: 'telefone invalido' };
  const components = bodyParams.length > 0 ? [{ type: 'body', parameters: bodyParams }] : [];
  return enqueue(() =>
    post({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components,
      },
    }),
  );
}