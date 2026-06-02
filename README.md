# República — Lembretes de Tarefas via WhatsApp

Disparador diário de lembretes de tarefas domésticas via **WhatsApp Cloud API (oficial da Meta)**, usando **Google Sheets como fonte da verdade**. Pensado para uma república com ~15 pessoas.

Todo dia, no horário configurado, o sistema lê a planilha e manda para cada pessoa as tarefas pendentes do dia. As pessoas respondem por WhatsApp (`feito`, `feito 2`, `pular 1`, `status`, `ajuda`…), o sistema interpreta e atualiza a planilha.

> Sem automações não oficiais (nada de `whatsapp-web.js`, Selenium ou scraping). Apenas API oficial.

## Sumário

- [Arquitetura e decisões](#arquitetura-e-decisoes)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Pré-requisitos](#pre-requisitos)
- [Estrutura da planilha](#estrutura-da-planilha)
- [Criar a planilha inicial](#criar-a-planilha-inicial)
- [Configurar o Google Service Account](#configurar-o-google-service-account)
- [Configurar a WhatsApp Cloud API](#configurar-a-whatsapp-cloud-api)
- [Configurar os templates na Meta](#configurar-os-templates-na-meta)
- [Configurar o .env](#configurar-o-env)
- [Rodar localmente](#rodar-localmente)
- [Testes](#testes)
- [Disparo manual e CSV](#disparo-manual-e-csv)
- [Deploy](#deploy)
- [Exemplos de mensagens](#exemplos-de-mensagens)
- [Segurança e opt-in](#seguranca-e-opt-in)
- [Limitações conhecidas](#limitacoes-conhecidas)

## Arquitetura e decisões

Camadas separadas, cada uma com uma responsabilidade:

| Módulo | Papel |
|---|---|
| `config` | Lê e valida o `.env` com `zod`. |
| `logger` | Logging simples; mascara segredos. |
| `sheets` | Acesso ao Google Sheets (leitura completa de abas, escrita em lote). |
| `tasks` | Regras de negócio puras + formatação de mensagens. |
| `parser` | Interpretação das respostas (função pura). |
| `whatsapp` | Envio pela Cloud API + fila serial com rate limit. |
| `scheduler` | Rotina diária (`node-cron`). |
| `webhook` | Rotas da Meta (GET verificação, POST mensagens). |
| `csv` | Backup/edição offline (export/import). |

Decisões importantes:

1. **Numeração estável sem estado de sessão.** A lista é sempre recomputada e ordenada por `task_id`, então `feito 1` casa com o `1` do lembrete sem precisar guardar nada.
2. **Virada de tarefas recorrentes.** No início da rotina, tarefas `daily`/`weekly` cuja instância (`data`) ficou no passado voltam para `pending` hoje. `once` nunca reinicia. O histórico de interações fica na aba `Mensagens`.
3. **Filtro de pendentes.** Os três filtros do enunciado (`status=pending`, `cobrar=TRUE`, não pausada por `skip_until`) mais uma guarda `data <= hoje` (para que tarefas `once` no futuro não sejam cobradas antes da hora).
4. **Janela de 24h.** Dentro da janela (a pessoa mandou mensagem nas últimas 24h), o lembrete é texto livre (formato multilinha bonito). Fora da janela, usa template aprovado — e a lista de tarefas vai num parâmetro de linha única, porque a Meta não aceita quebras de linha em parâmetros de template.
5. **Idempotência** pela aba `Mensagens` (intent `reminder` + chave ordenada das tarefas + data local). Mesmo lembrete no mesmo dia não é reenviado.
6. **Robustez por pessoa.** Telefone inválido ou erro de API não derruba o lote.

> Arquivos além da estrutura pedida, todos pequenos e justificados: `src/time.ts` (datas/fuso sem dependência), `src/csv.ts` (requisito de CSV) e `vitest.config.ts`.

## Estrutura do projeto

```
.
├── src/
│   ├── index.ts        # inicialização do servidor
│   ├── config.ts       # variáveis de ambiente (zod)
│   ├── logger.ts       # logging
│   ├── time.ts         # utilidades de data/fuso
│   ├── parser.ts       # interpretação das respostas
│   ├── tasks.ts        # regras de negócio + formatação
│   ├── sheets.ts       # Google Sheets
│   ├── whatsapp.ts     # WhatsApp Cloud API
│   ├── scheduler.ts    # rotina diária
│   ├── webhook.ts      # rotas do webhook
│   └── csv.ts          # export/import CSV
├── tests/
│   ├── parser.test.ts
│   └── tasks.test.ts
├── .env.example
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Pré-requisitos

- Node.js 20+
- Uma conta Meta for Developers com um app de WhatsApp.
- Uma planilha no Google Sheets e um Service Account do Google Cloud.

## Estrutura da planilha

Quatro abas com estes nomes exatos: `Pessoas`, `Tarefas`, `Mensagens`, `Config`.

> ⚠️ Importante: formate as colunas de data (`data`, `skip_until`) como Texto simples e use o formato `YYYY-MM-DD`. Se forem células de data formatadas em pt-BR, podem voltar como `01/06/2026` e quebrar as comparações.

### Aba Pessoas

Colunas: `person_id, nome, whatsapp_e164, ativo, opt_in, timezone, observacoes`

    person_id,nome,whatsapp_e164,ativo,opt_in,timezone,observacoes
    p001,Joao,+5582999999999,TRUE,TRUE,America/Sao_Paulo,
    p002,Maria,+5582988888888,TRUE,TRUE,America/Sao_Paulo,

### Aba Tarefas

Colunas: `task_id, person_id, descricao, data, status, periodicidade, cobrar, last_reminder_at, completed_at, skip_until, observacoes`

- `status`: `pending` | `done` | `skipped` | `cancelled`
- `periodicidade`: `daily` | `weekly` | `once`
- `cobrar`: `TRUE` | `FALSE`

```
task_id,person_id,descricao,data,status,periodicidade,cobrar,last_reminder_at,completed_at,skip_until,observacoes
t001,p001,Lavar a louça,2026-06-01,pending,daily,TRUE,,,,
t002,p001,Tirar o lixo,2026-06-01,pending,daily,TRUE,,,,
t003,p002,Limpar a sala,2026-06-01,pending,daily,TRUE,,,,
```

### Aba Mensagens

Colunas: `message_id, timestamp, direction, person_id, whatsapp_e164, body, parsed_intent, related_task_id, status`

- `direction`: `inbound` | `outbound`
- Apenas a linha de cabeçalho precisa existir; o sistema preenche o resto.

### Aba Config

Colunas: `key, value`

```
key,value
daily_reminder_enabled,TRUE
send_no_task_message,FALSE
language,pt-BR
```

## Criar a planilha inicial

1. Crie uma planilha nova no Google Sheets.
2. Crie quatro abas com os nomes exatos: `Pessoas`, `Tarefas`, `Mensagens`, `Config`.
3. Em cada aba, cole o cabeçalho (primeira linha) conforme acima.
4. Formate `data` e `skip_until` como Texto simples (Formatar → Número → Texto simples).
5. Preencha `Pessoas`, `Tarefas` e `Config` com seus dados (use os exemplos como base).
6. Copie o ID da planilha da URL: `https://docs.google.com/spreadsheets/d/ESTE_ID/edit`.
7. Compartilhe a planilha com o e-mail do Service Account (próxima seção) como Editor.

> Dica: você pode preencher localmente e subir via `npm run csv:import` (veja Disparo manual e CSV).

## Configurar o Google Service Account

1. Acesse o Google Cloud Console e crie/escolha um projeto.
2. Ative a Google Sheets API (APIs & Services → Library → "Google Sheets API" → Enable).
3. Crie uma Service Account (IAM & Admin → Service Accounts → Create).
4. Na Service Account, em Keys → Add key → Create new key → JSON, baixe o arquivo.
5. Do JSON, pegue:
   - `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` → `GOOGLE_PRIVATE_KEY`
6. Compartilhe a planilha com esse `client_email` dando permissão de Editor. (É assim que o app ganha acesso — não precisa de OAuth de usuário.)

### Sobre a chave privada no .env

A chave tem várias linhas. Coloque-a em uma única linha, trocando as quebras por `\n`, entre aspas:

```
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQI...\n...==\n-----END PRIVATE KEY-----\n"
```

O `config.ts` converte os `\n` em quebras reais automaticamente.

## Configurar a WhatsApp Cloud API

1. Em developers.facebook.com, crie um app do tipo Business e adicione o produto WhatsApp.
2. Em WhatsApp → API Setup, pegue:
   - Phone number ID → `META_PHONE_NUMBER_ID`
   - Token de acesso. O token de teste expira em 24h; para produção, crie um System User no Business Manager, gere um token permanente com a permissão `whatsapp_business_messaging` e use-o em `META_WHATSAPP_TOKEN`.
3. Webhook (WhatsApp → Configuration → Webhook):
   - Callback URL: `https://SEU_DOMINIO/webhook`
   - Verify token: o mesmo valor de `META_VERIFY_TOKEN`
   - Assine o campo `messages`.
4. (Opcional, recomendado) Pegue o App Secret (Settings → Basic) e ponha em `META_APP_SECRET` para validar a assinatura `X-Hub-Signature-256`.
5. Adicione números de teste (na fase de desenvolvimento) ou conclua a verificação para produção.

> A `GRAPH_API_VERSION` (ex.: `v20.0`) muda com o tempo. Se a Meta descontinuar a versão, atualize a variável.

## Configurar os templates na Meta

Templates são necessários para iniciar conversa fora da janela de 24h. Crie-os em WhatsApp → Message Templates (categoria Utility, idioma Português (BR) = `pt_BR`).

> ⚠️ Parâmetros de template não aceitam quebra de linha, tabs ou mais de 4 espaços seguidos. Por isso a lista de tarefas vai como uma linha (`1) Lavar a louça | 2) Tirar o lixo`). A versão multilinha bonita é usada nas respostas dentro da janela de 24h.

### Template lembrete_tarefas

Corpo (body) com dois parâmetros:

```
Oi, {{1}}. Estas são as suas tarefas de hoje: {{2}}. Responda "feito 1" para concluir uma, "feito" se já fez tudo, "status" para ver o que falta ou "ajuda".
```

- `{{1}}` = nome da pessoa
- `{{2}}` = lista em linha única (gerada pelo código)
- Exemplos para a revisão da Meta: `{{1}}` = `Joao`, `{{2}}` = `1) Lavar a louça | 2) Tirar o lixo`

### Template sem_tarefas

Corpo com um parâmetro:

```
Oi, {{1}}. Você não tem tarefas pendentes hoje.
```

- `{{1}}` = nome (exemplo de revisão: `Joao`)
- Só é usado se `send_no_task_message=TRUE` na aba `Config`.

Os nomes dos templates vêm de `WHATSAPP_TEMPLATE_TASKS` e `WHATSAPP_TEMPLATE_NO_TASKS`, e o idioma de `WHATSAPP_TEMPLATE_LANG`. Para mudar a quantidade/ordem dos parâmetros, ajuste as chamadas `sendTemplate(...)` em `src/scheduler.ts`.

## Configurar o .env

Copie o exemplo e preencha:

```
cp .env.example .env
```

Variáveis: veja `.env.example`. As obrigatórias são os tokens da Meta e as credenciais do Google; as demais têm padrão sensato.

## Rodar localmente

```
npm install
npm run dev
```

Ou em modo compilado:

```
npm run build && npm start
```

Verifique a saúde do servidor:

```
curl http://localhost:3000/health
```

Para testar o webhook localmente com a Meta, exponha a porta com um túnel HTTPS (ex.: `ngrok http 3000`) e use a URL pública na configuração do webhook.

## Testes

```
npm test
npm run test:watch
```

Cobrem: parser de comandos, busca de tarefas pendentes, marcação de tarefa como feita e prevenção de envio duplicado (além da virada de recorrentes e resolução de alvos).

## Disparo manual e CSV

Rodar a rotina diária agora (útil para testar):

```
npm run send:now
```

Exportar todas as abas para `./csv-export/`:

```
npm run csv:export
```

Importar um CSV para uma aba (⚠️ substitui todo o conteúdo da aba):

```
npm run csv:import -- Tarefas ./csv-export/Tarefas.csv
```

## Deploy

Você precisa de uma URL HTTPS pública para o webhook. Opções: Render, Railway, Fly.io, etc.

### Render (exemplo)

1. Novo Web Service apontando para o repositório.
2. Build: `npm install && npm run build` — Start: `npm start`.
3. Configure as variáveis de ambiente (as mesmas do `.env`).
4. A URL pública vira `https://seu-servico.onrender.com/webhook` no painel da Meta.

### Importante sobre o agendador

O lembrete diário usa `node-cron` dentro do processo. Isso só dispara se a instância estiver sempre ativa. Em planos que "dormem", o cron não roda. Duas saídas:

- Use uma instância always-on (a rotina dispara sozinha no horário).
- OU mantenha o web service só para o webhook e configure um cron job do provedor (Render Cron Jobs, Railway Cron, etc.) rodando `npm run send:now` no horário desejado.

### Docker

```
docker compose up --build
```

(Passa o `.env` via `env_file`. A chave privada em uma linha com `\n` funciona normalmente.)

## Exemplos de mensagens

Lembrete (texto livre, dentro de 24h):

```
Oi, Joao. Suas tarefas de hoje são:

1. Lavar a louça
2. Tirar o lixo

Responda:
- "feito 1" para marcar uma tarefa como concluída
- "feito" se todas já foram feitas
- "status" para ver o que ainda falta
- "ajuda" para ver os comandos
```

Pessoa responde / sistema responde:

| Mensagem recebida | Comportamento |
|---|---|
| `feito 1` | Marca a tarefa 1 como concluída e mostra o que ainda falta. |
| `feito 1,2` | Marca as tarefas 1 e 2. |
| `feito` (1 pendente) | Marca a única tarefa. |
| `feito` (várias pendentes) | Marca todas e avisa explicitamente que marcou todas. |
| `feito lavar louça` | Encontra a tarefa por descrição (avisa se houver ambiguidade). |
| `pular 1` | Pula a tarefa 1 só por hoje. |
| `status` | Lista o que ainda falta hoje. |
| `ajuda` | Mostra os comandos. |
| qualquer outra coisa | "Não entendi. Envie 'ajuda'…" |
| número não cadastrado | Avisa que o número não está cadastrado e registra a mensagem. |

## Segurança e opt-in

- Tokens nunca aparecem em log (o logger mascara campos sensíveis e o cliente de WhatsApp loga só o erro da Meta).
- O `.env` não é commitado (está no `.gitignore`). Use o `.env.example` como referência.
- Assinatura do webhook: defina `META_APP_SECRET` para validar `X-Hub-Signature-256` (recomendado em produção).
- Opt-in obrigatório: só são contatadas pessoas com `ativo=TRUE` e `opt_in=TRUE`. As pessoas precisam ter consentido em receber mensagens pelo WhatsApp (exigência da Meta e boa prática). Mantenha `opt_in=FALSE` até obter o consentimento.

## Limitações conhecidas

- Números do Brasil: o `wa_id` que a Meta envia precisa bater (só dígitos) com `whatsapp_e164` da planilha. Há casos históricos do "nono dígito"; se uma resposta não for reconhecida, confira em `Mensagens` o `whatsapp_e164` registrado e ajuste o cadastro.
- Concorrência: a planilha usa "última escrita vence". Para ~15 pessoas o risco de corrida é desprezível; para volumes maiores, considere um banco de dados.
- `feito` com várias pendentes marca todas e avisa explicitamente (não há confirmação em duas etapas, para evitar guardar estado de sessão). É fácil evoluir para confirmação se desejar.
- O parser de CSV é simples (RFC 4180 básico) — ideal para reimportar arquivos exportados pelo próprio sistema.
