import type { LlmContext, Intent } from "./types";
import { getPendingTasksForToday } from "./tasks";
import { getPendingAutoForToday } from "./autotask";
import { buildCombinedList, buildWeekCalendar, resolveTargets } from "./generictask";
import { weekdayName, addDays } from "./time";
import { formatHelpText } from "./messaging";
import { setPending } from "./pending";

// nao mexer, formato que o Gemini espera
interface FunctionDeclaration {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, unknown> };
}

type Executor = (ctx: LlmContext, args: Record<string, unknown>) => object;

const noArgs = { type: 'object' as const, properties: {} };

const registry: Record<string, { declaration: FunctionDeclaration; run: Executor }> = {
  tarefas_hoje: {
    declaration: {
      name: 'tarefas_hoje',
      description: 'Lista as tarefas pendentes de hoje da própria pessoa que está falando (normais e automáticas).',
      parameters: noArgs,
    },
    run: (ctx) => {
      const pid = ctx.person.person_id;
      const pending = getPendingTasksForToday(ctx.tasks, pid, ctx.today);
      const autoPending = getPendingAutoForToday(ctx.designated, pid, ctx.logicalToday);
      const combined = buildCombinedList(pending, autoPending, ctx.autoTask);
      return { dia_da_semana_hoje: weekdayName(ctx.today), tarefas: combined.map((t, i) => ({ numero: i + 1, descricao: t.descricao })) };
    },
  },

  minha_semana: {
    declaration: {
      name: 'minha_semana',
      description: 'Mostra o calendário das tarefas da própria pessoa para os próximos 7 dias.',
      parameters: noArgs,
    },
    run: (ctx) => {
      const pid = ctx.person.person_id;
      const pending = getPendingTasksForToday(ctx.tasks, pid, ctx.today);
      const autoPending = getPendingAutoForToday(ctx.designated, pid, ctx.logicalToday);
      const combined = buildCombinedList(pending, autoPending, ctx.autoTask);
      const calendar = buildWeekCalendar(ctx.tasks, ctx.designated, ctx.autoTask, pid, ctx.today, ctx.logicalToday);
      return {
        hoje: combined.map((t) => t.descricao),
        dia_da_semana_hoje: weekdayName(ctx.today),
        semana: calendar.map((d) => ({ dia: weekdayName(d.data), data: d.data, descricoes: d.descricoes })),
      };
    },
  },

  tarefas_casa: {
    declaration: {
      name: 'tarefas_casa',
      description: 'Resumo geral da casa: tarefas pendentes hoje de cada morador e quem está designado para as tarefas automáticas da semana.',
      parameters: noArgs,
    },
    run: (ctx) => {
      const nomeFromPid = (pid: string) => ctx.people.find((p) => p.person_id === pid)?.nome ?? pid;
      const descFromTid = (tid: string) => ctx.autoTask.find((a) => a.task_id === tid)?.descricao ?? tid;
      const pendentes_por_pessoa = ctx.people
        .filter((p) => p.ativo)
        .map((p) => {
          const pending = getPendingTasksForToday(ctx.tasks, p.person_id, ctx.today);
          const autoPending = getPendingAutoForToday(ctx.designated, p.person_id, ctx.logicalToday);
          const combined = buildCombinedList(pending, autoPending, ctx.autoTask);
          return { nome: p.nome, tarefas: combined.map((t) => t.descricao) };
        })
        .filter((x) => x.tarefas.length > 0);
      const designados_semana = ctx.designated
        .filter((d) => d.data >= ctx.logicalToday && d.data <= addDays(ctx.logicalToday, 6))
        .map((d) => ({ tarefa: descFromTid(d.task_id), pessoa: nomeFromPid(d.person_id), status: d.status, data: d.data }));
      return { pendentes_por_pessoa, designados_semana, dia_da_semana_hoje: weekdayName(ctx.today) };
    },
  },

  ajuda: {
    declaration: {
      name: 'ajuda',
      description: 'Retorna a lista oficial de comandos do bot. Use quando a pessoa perguntar o que você faz, quais comandos existem, como usar o bot, ou pedir ajuda.',
      parameters: noArgs,
    },
    run: (ctx) => {
      return { comandos: `${formatHelpText()}` };
    },
  },

  marcar_feito: {
    declaration: {
      name: 'marcar_feito',
      description: 'Marca o estado de uma tarefa ou de várias tarefas pendente(s) como "a confirmar" e pede para que o usuário digite "confirmar" para confirmar a marcação.',
      parameters: { type: 'object', properties: { tarefa: { type: 'string', description: 'Descrição da tarefa' } } }
    },
    run: (ctx, args) => {
      const tarefa = String(args.tarefa ?? '');
      const pendingTasks = getPendingTasksForToday(ctx.tasks, ctx.person.person_id, ctx.today);
      const pendingAuto = getPendingAutoForToday(ctx.designated, ctx.person.person_id, ctx.logicalToday);
      const combined = buildCombinedList(pendingTasks, pendingAuto, ctx.autoTask);
      const intent: Intent = tarefa ? { type: 'done', query: tarefa } : { type: 'done' };
      const r = resolveTargets(intent, combined);
      if (r.emptyList) return { tarefas_encontradas: 'Você não tem tarefas pendentes hoje.' };
      if (r.ambiguous.length > 0) return { tarefas_nome_semelhante: r.ambiguous.map((t) => t.descricao) };
      if (r.targets.length === 0) return { tarefas_encontradas: 'Nenhuma tarefa encontrada com esse nome' };
      setPending(ctx.person.whatsapp_e164, { kind: 'command', intent });
      const descricoes = r.targets.map((t) => t.descricao);
      if (r.markedAll) return { todas_as_tarefas: true, tarefa_a_confirmar: descricoes };
      return { tarefa_a_confirmar: descricoes };
    }
  }
};

export const functionDeclarations = Object.values(registry).map((r) => r.declaration);

export function runTool(name: string, ctx: LlmContext, args: Record<string, unknown>): object {
  const tool = registry[name];
  if (!tool) return { erro: `Ferramenta "${name}" não existe.` };
  return tool.run(ctx, args);
}
