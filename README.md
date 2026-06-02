# Sapebot — Lembretes de Tarefas automatizado via WhatsApp

Disparador diário de lembretes de tarefas domésticas via **WhatsApp Cloud API**, usando **Google Sheets como fonte da verdade**. Robustez projetada para **<50** pessoas.

Todo dia, no horário configurado (9h e 21h no horário de Brasília), o sistema lê a planilha e envia a cada pessoa as tarefas pendentes do dia. As pessoas respondem por WhatsApp (`feito`, `feito 2`, `pular 1`, `status`, `ajuda`), o sistema interpreta e atualiza a planilha. Um administrador pode criar tarefas pelo próprio WhatsApp.

## Sumário

- [Como funciona](#como-funciona)
- [Arquitetura](#arquitetura)
- [Modelo de dados](#modelo-de-dados)
- [Regras de negócio](#regras-de-negocio)
- [Comandos do usuário](#comandos-do-usuario)
- [Comandos de administrador](#comandos-de-administrador)
- [Rotinas agendadas](#rotinas-agendadas)
- [Segurança e privacidade](#seguranca-e-privacidade)
- [Limitações conhecidas](#limitacoes-conhecidas)

## Como funciona

O sistema tem dois fluxos independentes que rodam no mesmo processo:

**Saída (disparo diário).** Uma rotina agendada lê a planilha, calcula as tarefas pendentes de cada pessoa para o dia e envia um lembrete individual. A mensagem é texto livre quando há uma conversa aberta (a pessoa interagiu nas últimas 24h) ou um template aprovado pela Meta quando o sistema precisa iniciar a conversa.

**Entrada (webhook).** Quando alguém responde, a Meta entrega a mensagem ao webhook. O sistema identifica a pessoa pelo telefone, interpreta o comando, atualiza a planilha e responde — sempre em texto livre, pois a resposta acontece dentro da janela de conversa que a própria mensagem recebida abriu.

A planilha é a única fonte de verdade: não há banco de dados nem estado de sessão em memória. A cada operação o sistema relê o estado relevante, o que torna o comportamento previsível e fácil de inspecionar.

## Arquitetura

Camadas separadas, cada uma com uma responsabilidade única:

| Módulo | Papel |
|---|---|
| `config` | Lê e valida as variáveis de ambiente com `zod`. |
| `logger` | Logging simples; mascara segredos automaticamente. |
| `time` | Utilidades de data e fuso horário (via API `Intl`, sem dependências). |
| `parser` | Interpretação das respostas dos usuários (função pura). |
| `tasks` | Regras de negócio puras, tipos do domínio e formatação de mensagens. |
| `sheets` | Único módulo que fala com o Google Sheets (leitura de abas, escrita em lote). |
| `whatsapp` | Envio pela Cloud API, com fila serial e rate limit. |
| `scheduler` | Rotinas agendadas (`node-cron`): disparo diário e limpeza. |
| `webhook` | Rotas da Meta: verificação (GET) e recebimento de mensagens (POST). |
| `csv` | Backup e edição offline (export/import). |

A lógica de domínio (`parser`, `tasks`) é composta por funções puras, sem I/O — o que a torna trivialmente testável e independente das integrações externas.

## Modelo de dados

Quatro abas na planilha, com nomes exatos: `Pessoas`, `Tarefas`, `Mensagens`, `Config`.

**`Pessoas`** — quem recebe lembretes. Campos principais: `person_id`, `nome`, `whatsapp_e164`, `ativo`, `opt_in`, `timezone`. Só são contatadas pessoas com `ativo=TRUE` e `opt_in=TRUE`.

**`Tarefas`** — a fonte da verdade das tarefas. Campos principais: `task_id`, `person_id`, `descricao`, `data` (`YYYY-MM-DD`), `status` (`pending`/`done`/`skipped`/`cancelled`), `periodicidade` (`daily`/`weekly`/`once`), `cobrar` (`TRUE`/`FALSE`), além de `last_reminder_at`, `completed_at` e `skip_until`.

**`Mensagens`** — histórico de toda interação (entrada e saída). Usada para idempotência, deduplicação e cálculo da janela de 24h. Preenchida automaticamente.

**`Config`** — flags de comportamento em pares `key,value` (ex.: `daily_reminder_enabled`, `send_no_task_message`).

> As colunas de data são lidas como texto no formato `YYYY-MM-DD`. As comparações de data dependem disso.

## Regras de negócio

**Numeração estável sem estado de sessão.** A lista de tarefas é sempre recomputada e ordenada por `task_id`, então `feito 1` casa com o `1` do lembrete sem o sistema precisar guardar nada entre mensagens.

**Filtro de pendentes.** Uma tarefa é cobrada quando tem `status=pending`, `cobrar=TRUE`, não está pausada por `skip_until` e tem `data <= hoje` (evita cobrar tarefas `once` agendadas para o futuro).

**Virada de recorrentes.** No início do disparo, tarefas `daily`/`weekly` cuja instância ficou no passado voltam para `pending` no dia atual. Tarefas `once` nunca reiniciam.

**Janela de 24h.** Dentro da janela, o lembrete é texto livre em formato multilinha. Fora dela, usa template aprovado, com a lista de tarefas em parâmetro de linha única (a Meta não aceita quebras de linha em parâmetros de template).

**Idempotência.** O mesmo lembrete (mesma pessoa, mesma chave ordenada de tarefas, mesma data local) não é reenviado no mesmo dia, garantido por consulta à aba `Mensagens`.

**Robustez por pessoa.** Um telefone inválido ou erro de API não derruba o lote: o erro é registrado e o disparo segue para os demais.

**Normalização de telefone (BR).** A identificação por telefone tolera a presença ou ausência do nono dígito em celulares brasileiros (`55` + DDD + número), comparando ambos os lados por uma chave canônica.

## Comandos do usuário

| Mensagem recebida | Comportamento |
|---|---|
| `feito <numero>` | Marca a tarefa <numero> como concluída e mostra o que ainda falta. |
| `feito <n1,...>` | Marca as tarefas <n1,...>. |
| `feito` (1 pendente) | Marca a única tarefa. |
| `feito` (várias pendentes) | Marca todas e avisa explicitamente. |
| `feito lavar louça` | Encontra a tarefa por descrição (avisa se houver ambiguidade). |
| `pular 1` | Pula a tarefa 1 só por hoje. |
| `status` | Lista o que ainda falta hoje. |
| `ajuda` | Mostra os comandos disponíveis. |
| qualquer outra coisa | Resposta padrão orientando a enviar `ajuda`. |
| número não cadastrado | Avisa que o número não está cadastrado e registra a mensagem. |

A interpretação é tolerante: normaliza acentos e maiúsculas, e reconhece variações como `feito`/`feita`/`concluído` ou `pular`/`adiar`.

## Comandos de administrador

Administradores podem criar tarefas pelo WhatsApp, em um comando de linha única (sem estado de sessão):

```
admin <senha> add <person_id> <daily|weekly|once> <descrição>
```

A autorização é dupla: o telefone remetente precisa estar na lista de administradores **e** a senha precisa conferir. A senha trafega em texto puro pelo WhatsApp, portanto a lista de telefones é a trava principal de segurança; o corpo do comando é redigido antes de ser gravado na aba `Mensagens`, para que a senha não fique registrada.

## Rotinas agendadas

Duas rotinas independentes rodam via `node-cron`, ambas no fuso configurado:

- **Disparo diário** de lembretes, no horário definido por `REMINDER_HOUR`/`REMINDER_MINUTE`.
- **Limpeza da aba `Mensagens`**, mantendo apenas as últimas 48h. A retenção é segura porque idempotência, deduplicação e janela de 24h só dependem de registros recentes.

Como o agendamento vive dentro do processo, ele exige uma instância sempre ativa. Em planos que "dormem", use uma instância always-on ou um cron job do provedor disparando a rotina.

## Segurança e privacidade

- Segredos nunca aparecem em log: o logger mascara campos sensíveis e o cliente de WhatsApp registra apenas o erro retornado pela Meta.
- Variáveis de ambiente (tokens da Meta, credenciais do Google, senha de admin) ficam fora do versionamento.
- Assinatura do webhook validada via `X-Hub-Signature-256` quando o segredo do app está configurado.
- Opt-in obrigatório: só são contatadas pessoas que consentiram (`ativo=TRUE` e `opt_in=TRUE`), conforme exigência da Meta e boa prática.

## Limitações conhecidas

- **Concorrência:** a planilha opera por "última escrita vence". Para <50 pessoas o risco de corrida é desprezível; volumes maiores pedem um banco de dados.
- **`feito` com várias pendentes** marca todas e avisa, sem confirmação em duas etapas (decisão deliberada para não guardar estado de sessão).
- **Telefones:** a identificação depende de o número enviado pela Meta casar com o cadastro; a normalização cobre o nono dígito, mas cadastros divergentes ainda precisam de ajuste manual.
- **Parser de CSV** simples (RFC 4180 básico), adequado para reimportar arquivos exportados pelo próprio sistema.