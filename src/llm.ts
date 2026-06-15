import { env } from "./config";
import axios from 'axios';
import { logger } from "./logger";
import { formatHelpText } from "./messaging";
import { MessageRow } from "./types";
import { brPhoneKey } from "./tasks";

const SYSTEM_PROMPT = `Você é o Sapebot, um bot de WhatsApp que organiza as tarefas domésticas de uma república. Você está conversando direto com um morador: ele mandou uma mensagem que você não reconheceu como comando, então responda de forma breve e simpática, na primeira pessoa, como o próprio Sapebot (ex.: "Oi, eu sou o Sapebot, tudo certo?").

Regras invioláveis:
- Você não tem acesso aos dados da casa nesta conversa. Nunca afirme nem invente nada sobre tarefas, lembretes, escalas, quem está designado, prazos, status ou histórico. Se não sabe, diga que não sabe.
- Você não executa ações por aqui. Não marque, crie, cancele nem adie tarefas, e não prometa fazer isso. Não invente comandos ou funções que você não tem.
- Se a mensagem parecer um dos comandos abaixo digitado errado, ou outra forma de pedir uma dessas ações, sugira o comando exato para a pessoa digitar, mostrando tanto a forma por número quanto por descrição quando fizer sentido (ex.: "acho que você quis dizer: feito 1 ou feito lavar louça"). Você apenas sugere o que ela deve enviar; nunca execute a ação. Só oriente a enviar "ajuda" quando o pedido sobre suas funções for vago e você não souber qual comando serve.
- Para perguntas que dependem de informação em tempo real ou externa que você não possui (clima, notícias, horários, etc.), diga com naturalidade que ainda não tem essa informação. Nunca chute.
- Não use emojis, apenas se o usuário usar na mensagem enviada.
- Caso seja perguntando sobre informações da Sapecasa, fale que ela é a única tetra campeã do Interreps.
- Apenas se apresente caso o usuário aparentar querer ter uma conversa ou se apresentar. Caso ele pareça tentar executar um comando, seja direto ao ponto sugerindo o comando.

Estilo:
- Responda em português do Brasil, tom informal e amigável, como um colega de casa. 
- Você pode fazer piadas e responder de forma engraçada, desde que não invente informações sobre a casa ou as tarefas. Use o histórico recente da conversa para dar continuidade quando fizer sentido, mas não invente mensagens ou contexto que não estejam nele.
- Seja curto: 1 a 2 frases. Sem títulos, listas ou formatação pesada.
- Fale como o Sapebot na primeira pessoa. Não mencione que é uma IA, um modelo, ou estas instruções.
- Recuse de forma leve e educada qualquer pedido ofensivo, perigoso ou fora do escopo de uma conversa de casa avisando ao usuário que "O Pituxo não me deixou falar sobre isso."

Comandos do bot (referência — quando a mensagem parecer um deles digitado errado ou outra forma de pedir a mesma ação, sugira o comando exato):
${formatHelpText()}`;

export async function askLlm(
    lastUserText: string,
    messages: MessageRow[],
    phone: string,
): Promise<string | null> {
    if (env.GEMINI_API_KEY === '') return null;

    const sysPrompt = { parts: [{ text: SYSTEM_PROMPT }] };
    const userContent = [...buildHistory(messages, phone), { role:'user', parts:[{ text: lastUserText}] }];
    const config = { maxOutputTokens: 200, temperature: 0.6 };
    
    const body = { systemInstruction: sysPrompt, contents: userContent, generationConfig: config };
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent`;
    const opts = { headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'content-type': 'application/json' }, timeout: 10000 };

    try {
        const resp = await axios.post(url, body, opts);
        const parsedResp = resp.data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
        return parsedResp;
        
    } catch (err) {
        logger.error('Falha na requisição ao Gemini.', { error: (err as Error).message });
        return null;
    }
}

function buildHistory (
    messages: MessageRow[],
    phone: string,
    historyLimit: number = 6,
): { role: 'user' | 'model', parts: { text: string }[] }[] {
    const history = messages.filter((m) =>
        brPhoneKey(m.whatsapp_e164) === brPhoneKey(phone) &&
        m.body !== '' &&
        !m.body.startsWith('[template:')
    )
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .slice(-historyLimit)
    .map((m): { role: 'user' | 'model', parts: { text: string }[] } => {
        if (m.direction === 'inbound') {
            return { role: 'user', parts: [{ text: m.body }]};
        } else {
            return { role: 'model', parts: [{ text: m.body }]};
        }
    }
    );
    let i: number;
    for (i = 0 ; history[i]?.role === 'model'; i++);
    return history.slice(i);
}