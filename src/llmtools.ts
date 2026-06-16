import type { LlmContext } from "./types";
import { getPendingTasksForToday } from "./tasks";
import { getPendingAutoForToday } from "./autotask";
import { buildCombinedList, buildWeekCalendar } from "./generictask";
import { weekdayName, addDays } from "./time";
import { formatHelpText } from "./messaging";

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
      return { tarefas: combined.map((t, i) => ({ numero: i + 1, descricao: t.descricao })) };
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
        semana: calendar.map((d) => ({ dia: weekdayName(d.data), descricoes: d.descricoes })),
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
      return { pendentes_por_pessoa, designados_semana };
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
};

export const functionDeclarations = Object.values(registry).map((r) => r.declaration);

export function runTool(name: string, ctx: LlmContext, args: Record<string, unknown>): object {
  const tool = registry[name];
  if (!tool) return { erro: `Ferramenta "${name}" não existe.` };
  return tool.run(ctx, args);
}
