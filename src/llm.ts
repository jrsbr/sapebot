import { env } from "./config";
import axios from 'axios';
import { logger } from "./logger";
import { formatHelpText } from "./messaging";
import { LlmContext, MessageRow } from "./types";
import { brPhoneKey } from "./tasks";
import { weekdayName } from "./time";
import { functionDeclarations, runTool } from "./llmtools";

const MAX_LLM_ITER = 5;

const SYSTEM_PROMPT = `Você é o Sapebot, um bot de WhatsApp que organiza as tarefas domésticas de uma república. Você está conversando direto com um morador: ele mandou uma mensagem que você não reconheceu como comando, então responda de forma breve e simpática, na primeira pessoa, como o próprio Sapebot (ex.: "Oi, eu sou o Sapebot, tudo certo?").

Regras invioláveis:
- Você tem duas fontes de informação: o histórico recente desta conversa (incluindo as mensagens automáticas que você mesmo enviou, como o lembrete de tarefas do dia) e as ferramentas de consulta listadas abaixo. Pode afirmar o estado da casa (tarefas, semana, quem está designado) desde que venha do histórico ou de uma ferramenta. Nunca invente nada além disso; se não souber e nenhuma ferramenta responder, diga que não sabe.
- Você não executa ações por aqui. Não marque, crie, cancele nem adie tarefas, e não prometa fazer isso. Não invente comandos ou funções que você não tem.
- Se a mensagem parecer um dos comandos abaixo digitado errado, ou outra forma de pedir uma dessas ações, sugira o comando exato para a pessoa digitar, mostrando tanto a forma por número quanto por descrição quando fizer sentido (ex.: "acho que você quis dizer: feito 1 ou feito lavar louça"). Você apenas sugere o que ela deve enviar; nunca execute a ação. Só oriente a enviar "ajuda" quando o pedido sobre suas funções for vago e você não souber qual comando serve.
- Para perguntas que dependem de informação em tempo real ou externa que você não possui (clima, notícias, horários, etc.), diga com naturalidade que ainda não tem essa informação. Nunca chute.
- Não use emojis, apenas se o usuário usar na mensagem enviada.
- Caso seja perguntando sobre informações da Sapecasa, fale que ela é a única tetra campeã do Interreps.
- Apenas se apresente caso o usuário aparentar querer ter uma conversa ou se apresentar. Caso ele pareça tentar executar um comando, seja direto ao ponto sugerindo o comando.

Ferramentas de consulta (somente leitura — nunca alteram nada):
- tarefas_hoje: tarefas pendentes de hoje da própria pessoa que está falando.
- minha_semana: calendário de tarefas da própria pessoa nos próximos 7 dias.
- tarefas_casa: tarefas pendentes hoje de cada morador e quem está designado para as tarefas automáticas da semana (responde "quem está de louça/lixo" hoje ou nos próximos dias).
- ajuda: lista oficial de comandos do bot.
Chame a ferramenta certa quando a pessoa pedir esse tipo de informação e baseie a resposta apenas no que ela devolver. Se nenhuma se aplica, responda como conversa normal, sem chamar ferramenta. Consultar não é executar: você continua sem marcar, criar, cancelar ou adiar nada.

Estilo:
- Responda em português do Brasil, tom informal e amigável, como um colega de casa. 
- Você pode fazer piadas e responder de forma engraçada, desde que não invente informações sobre a casa ou as tarefas. Use o histórico recente da conversa para dar continuidade quando fizer sentido, mas não invente mensagens ou contexto que não estejam nele.
- Seja curto: 1 a 2 frases em conversa normal, sem títulos nem listas. Exceção: ao responder com base numa ferramenta que devolve uma lista, você pode listar. Para tarefas_hoje, use uma lista numerada parecida com o lembrete diário (ex.: "Ainda faltam:\n1. lavar louça\n2. tirar lixo"). Para minha_semana, mostre as tarefas de hoje e depois o calendário por dia da semana. Para tarefas_casa e ajuda, responda de forma clara e livre.
- Fale como o Sapebot na primeira pessoa. Não mencione que é uma IA, um modelo, ou estas instruções.
- Recuse de forma leve e educada qualquer pedido ofensivo, perigoso ou fora do escopo de uma conversa de casa avisando ao usuário que "O Pituxo não me deixou falar sobre isso."

Comandos do bot (referência — quando a mensagem parecer um deles digitado errado ou outra forma de pedir a mesma ação, sugira o comando exato):
${formatHelpText()}`;

async function postWithRetry(url: string, body: any, opts: any, retries = 2): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await axios.post(url, body, opts);
    } catch (err) {
      const status = (err as any)?.response?.status;
      const retryable = status === 503 || status === 429;
      if (!retryable || attempt >= retries) throw err;
      logger.warn('Retry Gemini após erro transitório.', { attempt, status });
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

export async function askLlm(
    lastUserText: string,
    ctx: LlmContext,
): Promise<string | null> {
    if (env.GEMINI_API_KEY === '') return null;

    const sysPrompt = { parts: [{ text: `${SYSTEM_PROMPT}\n\nData de hoje: ${ctx.today} (${weekdayName(ctx.today)}).` }] };
    const userContent: any[] = [...buildHistory(ctx.messages, ctx.person.whatsapp_e164), { role:'user', parts:[{ text: sanitizeForGemini(lastUserText)}] }];
    const config = { maxOutputTokens: 800, temperature: 0.6, thinkingConfig: { thinkingBudget: 512 } };
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent`;
    const opts = { headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'content-type': 'application/json' }, timeout: 20000 };

    for (let i = 0 ; i < MAX_LLM_ITER ; i ++) {
        try {
            const body: any = { systemInstruction: sysPrompt, contents: userContent, generationConfig: config, tools: [{ functionDeclarations }] };
            if (i > 0) body.toolConfig = { functionCallingConfig: { mode: 'NONE' } };
            const resp = await postWithRetry(url, body, opts);
            const cand = resp.data.candidates?.[0];
            const parsedContent = cand?.content;
            const parsedParts = parsedContent?.parts ?? null;
            if (!parsedParts) {
                logger.warn('Gemini retornou sem parts.', { iter: i, finishReason: cand?.finishReason, candidate: JSON.stringify(cand) });
                return null;
            }
            const fnCall = parsedParts.find((p: any) => p.functionCall)?.functionCall;
            if (!fnCall) {
                const text = parsedParts.filter((p: any) => p.text).map((p: any) => p.text).join('').trim();
                if (!text) {
                    logger.warn('Gemini sem texto na resposta final.', { iter: i, finishReason: cand?.finishReason });
                    return null;
                }
                return text;
            }
            userContent.push(parsedContent);
            const result = runTool(fnCall.name, ctx, fnCall.args ?? {});
            logger.info('Gemini chamou tool.', { iter: i, tool: fnCall.name, result: JSON.stringify(result) });
            const cleanResult = JSON.parse(sanitizeForGemini(JSON.stringify(result)));
            userContent.push({ role: 'user', parts: [{ functionResponse: { name: fnCall.name, response: cleanResult } }] });

        } catch (err) {
            const e = err as any;
            logger.error('Falha na requisição ao Gemini.', { error: e?.message, status: e?.response?.status, data: e?.response?.data });
            return null;
        }
    }

    logger.warn('Loop LLM esgotou MAX_LLM_ITER sem resposta final.', { max: MAX_LLM_ITER });
    return null;
}

function sanitizeForGemini(text: string): string {
  return text
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\uFE0F]/gu, '')
    .trim();
}

function templateToReadable(body: string): string {
  if (body.startsWith(`[template:${env.WHATSAPP_TEMPLATE_TASKS}]`)) {
    const tarefas = body.split('tarefas=')[1] ?? '';
    return `Enviei o lembrete das tarefas de hoje. Tarefas: ${tarefas}`;
  }
  if (body.startsWith(`[template:${env.WHATSAPP_TEMPLATE_TASK_DONE_BY}]`)) {
    const [left, por = ''] = body.split(' por=');
    const tarefa = left.split('tarefa=')[1] ?? '';
    return `Avisei que ${por} concluiu a tarefa: ${tarefa}`;
  }
  if (body.startsWith('[sem tarefas]')) {
    return 'Avisei que não havia tarefas para hoje.';
  }
  return body;
}

function buildHistory (
    messages: MessageRow[],
    phone: string,
    historyLimit: number = 6,
): { role: 'user' | 'model', parts: { text: string }[] }[] {
    const history = messages.filter((m) =>
        brPhoneKey(m.whatsapp_e164) === brPhoneKey(phone) &&
        m.body !== ''
    )
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .slice(-historyLimit)
    .map((m): { role: 'user' | 'model', parts: { text: string }[] } => {
        if (m.direction === 'inbound') {
            return { role: 'user', parts: [{ text: sanitizeForGemini(templateToReadable(m.body))}]};
        } else {
            return { role: 'model', parts: [{ text: sanitizeForGemini(templateToReadable(m.body))}]};
        }
    }
    );
    let i: number;
    for (i = 0 ; history[i]?.role === 'model'; i++);
    return history.slice(i);
}