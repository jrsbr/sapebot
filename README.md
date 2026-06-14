# Sapebot — Lembretes de Tarefas automatizado via WhatsApp

Assistente de tarefas domésticas para repúblicas e casas compartilhadas, via **WhatsApp Cloud API**, usando **Google Sheets como fonte da verdade**. Pensado para grupos de **menos de 50 pessoas**.

Todos os dias, nos horários configurados (manhã e noite), o sistema lê a planilha e envia a cada pessoa as suas tarefas pendentes. As pessoas respondem pelo WhatsApp (`feito`, `pular`, `status`, `semana`, `ajuda`), o sistema interpreta e atualiza a planilha. Além das tarefas pessoais, o sistema cuida das **tarefas da casa** (rodízio automático), de **tarefas em grupo** (vínculo entre pessoas) e de um **modo férias**. Um administrador cria e gerencia tarefas pelo próprio WhatsApp.

## Sumário

- [Como funciona](#como-funciona)
- [Arquitetura](#arquitetura)
- [Modelo de dados](#modelo-de-dados)
- [Funcionalidades](#funcionalidades)
- [Regras de negócio](#regras-de-negocio)
- [Comandos do usuário](#comandos-do-usuario)
- [Comandos de administrador](#comandos-de-administrador)
- [Rotinas agendadas](#rotinas-agendadas)
- [Segurança e privacidade](#seguranca-e-privacidade)
- [Limitações conhecidas](#limitacoes-conhecidas)

## Como funciona

O sistema tem dois fluxos independentes no mesmo processo:

**Saída (lembretes).** Uma rotina agendada lê a planilha, calcula as tarefas pendentes de cada pessoa e envia um lembrete individual. A mensagem é texto livre quando há uma conversa aberta (a pessoa interagiu nas últimas 24h) ou um template aprovado pela Meta quando o sistema precisa iniciar a conversa.

**Entrada (webhook).** Quando alguém responde, a Meta entrega a mensagem ao webhook. O sistema identifica a pessoa pelo telefone, interpreta o comando, atualiza a planilha e responde — sempre em texto livre, dentro da janela de conversa que a própria mensagem recebida abriu.

A planilha é a única fonte de verdade: não há banco de dados nem estado de sessão em memória. A cada operação o sistema relê o estado relevante, o que torna o comportamento previsível e fácil de inspecionar.

## Arquitetura

Camadas separadas, cada uma com uma responsabilidade única:

| Módulo | Papel |
|---|---|
| `config` | Lê e valida as variáveis de ambiente com `zod`. |
| `logger` | Logging simples; mascara segredos automaticamente. |
| `time` | Utilidades de data e fuso horário (via API `Intl`, sem dependências). |
| `parser` | Interpretação das respostas dos usuários (função pura). |
| `adminparser` | Interpretação dos comandos de administrador: tokenizer com aspas e flags (função pura). |
| `tasks` | Regras de negócio puras, incluindo a correspondência aproximada de nomes e descrições. |
| `autotask` | Regras das tarefas automáticas da casa (função pura). |
| `generictask` | Unifica tarefas normais e automáticas em uma lista numerada única. |
| `messaging` | Formatação das mensagens e predicados de histórico. |
| `sheets` | Único módulo que fala com o Google Sheets (leitura de abas, escrita em lote). |
| `whatsapp` | Envio pela Cloud API, com fila serial e rate limit. |
| `scheduler` | Rotinas agendadas (`node-cron`): lembretes, tarefas automáticas e limpeza. |
| `webhook` | Rotas da Meta: verificação (GET) e recebimento de mensagens (POST). |
| `csv` | Backup e edição offline (export/import). |

A lógica de domínio (`parser`, `adminparser`, `tasks`, `autotask`) é composta por funções puras, sem I/O — trivialmente testável e independente das integrações externas.

## Modelo de dados

As abas principais da planilha, com nomes exatos: `Pessoas`, `Tarefas`, `Mensagens`, `Config`.

**`Pessoas`** — quem recebe lembretes. Campos principais: `person_id`, `nome`, `whatsapp_e164`, `ativo`, `opt_in`, `timezone`, `ferias`. Só são contatadas pessoas com `ativo=TRUE` e `opt_in=TRUE`.

**`Tarefas`** — a fonte da verdade das tarefas. Campos principais: `task_id`, `person_id`, `descricao`, `data` (`YYYY-MM-DD`), `status` (`pending`/`done`/`skipped`/`cancelled`), `periodicidade` (`daily`/`weekly`/`once`), `cobrar` (`TRUE`/`FALSE`) e `grupo` (vínculo entre tarefas iguais de pessoas diferentes; vazio = sem vínculo), além de `last_reminder_at`, `completed_at` e `skip_until`.

**`Mensagens`** — histórico de toda interação (entrada e saída). Usada para idempotência, deduplicação e cálculo da janela de 24h. Preenchida automaticamente.

**`Config`** — flags de comportamento em pares `key,value` (ex.: `daily_reminder_enabled`, `send_no_task_message`).

> As tarefas automáticas da casa usam abas próprias, para a definição de cada tarefa e para o calendário/histórico de quem ficou responsável em cada dia.

> As colunas de data são lidas como texto no formato `YYYY-MM-DD`. As comparações de data dependem disso.

## Funcionalidades

**Lembretes diários.** Cada pessoa recebe, de manhã e à noite, a lista numerada das suas tarefas pendentes do dia.

**Tarefas da casa (automáticas).** Tarefas coletivas — como tirar o lixo e lavar a louça — são geradas e distribuídas automaticamente entre as pessoas, com um rodízio justo que favorece quem tem cumprido melhor. Elas aparecem na mesma lista dos lembretes e são respondidas com `feito`, mas não podem ser puladas.

**Tarefas em grupo.** Tarefas iguais atribuídas a várias pessoas podem ser vinculadas por um grupo. Quando uma pessoa marca a sua como feita, as tarefas vinculadas das outras também são concluídas e cada uma recebe um aviso automático de que a tarefa saiu da sua lista.

**Modo férias.** A pessoa pode se declarar de férias e parar de receber as tarefas da casa enquanto estiver fora, voltando ao rodízio quando retornar. As tarefas pessoais continuam.

**Calendário da semana.** A pessoa pode consultar, a qualquer momento, suas tarefas dos próximos sete dias.

**Saudação de bom dia.** Uma mensagem de "bom dia" recebe uma saudação com uma frase do dia, quando enviada no período da manhã.

**Correspondência aproximada.** Comandos por descrição ou por nome (`feito lavar louça`, `admin add -p Joao ...`) toleram erros de digitação e variações. A semelhança é medida por distância de **Damerau-Levenshtein** (que conta inserções, remoções, trocas e transposições de letras); havendo empate entre candidatos, o sistema pede para desambiguar em vez de adivinhar.

## Regras de negócio

**Numeração estável sem estado de sessão.** A lista de tarefas é sempre recomputada e ordenada de forma determinística, então `feito 1` casa com o `1` do lembrete sem o sistema precisar guardar nada entre mensagens.

**Filtro de pendentes.** Uma tarefa é cobrada quando tem `status=pending`, `cobrar=TRUE`, não está pausada por `skip_until` e tem `data <= hoje` (evita cobrar tarefas `once` agendadas para o futuro).

**Virada de recorrentes.** Tarefas `daily`/`weekly` cuja instância ficou no passado voltam para `pending` no dia atual. Tarefas `once` nunca reiniciam.

**Janela de 24h.** Dentro da janela de conversa, as mensagens são texto livre. Fora dela, o sistema usa templates aprovados pela Meta, como exige a plataforma.

**Idempotência.** O mesmo lembrete (mesma pessoa, mesmas tarefas, mesma data) não é reenviado no mesmo dia, garantido por consulta à aba `Mensagens`.

**Robustez por pessoa.** Um telefone inválido ou um erro de API não derruba o lote: o erro é registrado e o processamento segue para os demais.

**Normalização de telefone (BR).** A identificação por telefone tolera a presença ou ausência do nono dígito em celulares brasileiros, comparando ambos os lados por uma chave canônica.

## Comandos do usuário

| Mensagem recebida | Comportamento |
|---|---|
| `feito <numero>` | Marca a tarefa `<numero>` como concluída e mostra o que ainda falta. |
| `feito <n1,n2,...>` | Marca várias tarefas de uma vez. |
| `feito` (1 pendente) | Marca a única tarefa pendente. |
| `feito` (várias pendentes) | Marca todas e avisa explicitamente. |
| `feito lavar louça` | Encontra a tarefa por descrição (avisa se houver ambiguidade). |
| `pular 1` | Pula a tarefa 1 só por hoje (não vale para tarefas da casa). |
| `status` | Lista o que ainda falta hoje. |
| `semana` | Mostra o calendário de tarefas dos próximos sete dias. |
| `ferias` / `voltar ferias` | Entra ou sai do modo férias (com confirmação). |
| `bom dia` | Responde com uma saudação da manhã. |
| `ajuda` | Mostra os comandos disponíveis. |
| qualquer outra coisa | Resposta padrão orientando a enviar `ajuda`. |
| número não cadastrado | Avisa que o número não está cadastrado e registra a mensagem. |

A interpretação é tolerante: normaliza acentos e maiúsculas, e reconhece variações como `feito`/`feita`/`concluído` ou `pular`/`adiar`.

## Comandos de administrador

Administradores gerenciam tarefas pelo WhatsApp, em comandos de linha única no estilo de flags (como uma linha de comando). O formato é:

```
admin <subcomando> <flags...>
```

Cada flag tem um significado fixo em todos os subcomandos; o valor vem logo após a flag, e a ordem das flags é livre:

| Flag | Significado |
|---|---|
| `-p <pessoa>` | Pessoa (nome ou `person_id`). |
| `-m "<descrição>"` | Descrição da tarefa (use aspas se tiver espaços). |
| `-g <grupo>` | Grupo, para vincular tarefas iguais entre pessoas. |
| `-t <AAAA-MM-DD>` | Data da tarefa. |
| `-o` / `-w` / `-d` | Periodicidade: uma vez / semanal / diária. |

Subcomandos:

| Subcomando | Obrigatório | Opcional | O que faz |
|---|---|---|---|
| `add` | `-p`, `-m`, uma periodicidade | `-g`, `-t` | Cria uma tarefa para a pessoa. |
| `remove` | `-m`, `-p` | — | Remove a tarefa indicada da pessoa. |
| `list` | — | `-p` | Lista as tarefas em aberto (de todos ou de uma pessoa). |
| `report` | — | `-p` | Relatório das tarefas da casa que ficaram pendentes nos últimos dias. |

Exemplos:

```
admin add -p João -m "lavar a louça" -d
admin add -p João -m "lavar a louça" -d -g cozinha
admin add -p Maria -m "tirar o lixo" -w -t 2026-06-20
admin remove -p João -m "lavar a louça"
admin list -p João
admin report
```

Mensagens de erro são amigáveis e trazem um exemplo de uso correto. Aspas curvas inseridas automaticamente por teclados de celular são normalizadas, então `"…"` e `“…”` funcionam igual.

## Rotinas agendadas

Rotinas independentes rodam via `node-cron`, no fuso configurado:

- **Lembretes diários**, de manhã e à noite.
- **Tarefas da casa**: fechamento das pendências do dia anterior e geração da próxima janela de responsáveis.
- **Limpeza da aba `Mensagens`**, mantendo apenas os registros recentes — o suficiente para idempotência, deduplicação e janela de 24h.

Como o agendamento vive dentro do processo, ele exige uma instância sempre ativa. Em planos que "dormem", use uma instância always-on ou um cron job do provedor disparando a rotina.

## Segurança e privacidade

- Segredos nunca aparecem em log: o logger mascara campos sensíveis e o cliente de WhatsApp registra apenas o erro retornado pela Meta.
- Variáveis de ambiente (tokens da Meta, credenciais do Google) ficam fora do versionamento.
- Comandos de administrador são restritos aos telefones autorizados, e o webhook valida a assinatura `X-Hub-Signature-256` de cada requisição.
- Opt-in obrigatório: só são contatadas pessoas que consentiram (`ativo=TRUE` e `opt_in=TRUE`), conforme exigência da Meta e boa prática.

## Limitações conhecidas

- **Concorrência:** a planilha opera por "última escrita vence". Para menos de 50 pessoas o risco de corrida é desprezível; volumes maiores pedem um banco de dados.
- **`feito` com várias pendentes** marca todas e avisa, sem confirmação em duas etapas (decisão deliberada para não guardar estado de sessão).
- **Telefones:** a identificação depende de o número enviado pela Meta casar com o cadastro; a normalização cobre o nono dígito, mas cadastros divergentes ainda precisam de ajuste manual.
- **Parser de CSV** simples (RFC 4180 básico), adequado para reimportar arquivos exportados pelo próprio sistema.
