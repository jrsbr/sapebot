import type { Person, AutoTask, Designated, Designation } from "./types";

function isDesignatedThisDay (
    designateds: Designated[],
    task_id: string,
    date: string,
): boolean {
    return designateds.some((d) => (date === d.data && task_id === d.task_id));
}

export function expiredPendingDesignated (
    designateds: Designated[],
    logicalDate: string,
): Designated[] {
    return designateds.filter((d) => (d.status === 'pending' && logicalDate > d.data));
}

export function countInWindow (
    designateds: Designated[],
    person_id: string,
    corte: string,
): { done: number, missed: number, pending: number } {
    const personTasks = designateds.filter((d) => d.person_id === person_id && d.data >= corte);
    const done = personTasks.filter((p) => p.status === 'done').length;
    const missed = personTasks.filter((p) => p.status === 'missed').length;
    const pending = personTasks.filter((p) => p.status === 'pending').length;
    return { done, missed, pending };
}

export function successRate (
    done: number,
    missed: number,
    pending: number,
): number {
    if (done + pending + missed === 0) return 0; // Prioridade máxima para quem não fez nada
    return (done + pending) / (done + pending + missed)
}

export function countDoneByTaskPerson (
    designateds: Designated[],
    person_id: string,
    task_id: string,
    corte: string,
): number {
    const total = designateds.filter((d) => 
        d.person_id === person_id &&
        d.task_id === task_id &&
        d.status === 'done' &&
        d.data >= corte
        ).length;
    return total;
}

export function selectDayAssignments(
  pool: Person[],            // já filtrado: ativo, opt_in, !ferias
  autoTasks: AutoTask[],     // os 2 task_ids
  designated: Designated[],  // estado atual (inclui o já gerado nesta rodada)
  data: string,              // o dia (YYYY-MM-DD)
  corte: string,             // piso da janela
): Designated[] {
  // 0. Fallback: pool < 2 → retorna [] (não gera nada)
  if (pool.length < 2) return [];

  // 1. Montar métricas de cada pessoa: { person, done, taxa }
  //    usando countInWindow (peça 2) e successRate (peça 3)
  let metrics = pool.map((p) => {
    const { done, missed, pending } = countInWindow(designated, p.person_id,corte);
    return { person_id: p.person_id, done, rate: successRate(done, missed, pending) };
    })

  // 2. Escolher A: menor done → menor taxa → nome (alfabético)
  //    ordenar uma cópia das métricas por esse comparador em cascata, pegar [0]
  const A = metrics.sort((a, b) => 
    a.done - b.done ||
    a.rate - b.rate ||
    a.person_id.localeCompare(b.person_id))[0];

  // 3. Escolher B: entre os restantes (sem A), pior taxa → menor done → nome
  const rateSorted = metrics.sort((a, b) => 
    a.rate - b.rate ||
    a.done - b.done ||
    a.person_id.localeCompare(b.person_id));
  let B = rateSorted[0];
  if (B.person_id === A.person_id) B = rateSorted[1];

  // 4. A escolhe a tarefa: countDoneByTaskPerson (peça 4) de cada task pra A
  //    menor vence; empate → a que B fez mais; duplo empate → task_id alfabético
  const t1 = autoTasks[0].task_id;
  const t2 = autoTasks[1].task_id;
  const decideTask = (
    firstPerson: string,
    secondPerson: string,
  ): string => {
    const aTask1 = countDoneByTaskPerson(designated, firstPerson, t1, corte);
    const aTask2 = countDoneByTaskPerson(designated, firstPerson, t2, corte);
    if (aTask1 === aTask2) {
        const bTask1 = countDoneByTaskPerson(designated, secondPerson, t1, corte);
        const bTask2 = countDoneByTaskPerson(designated, secondPerson, t2, corte);
        if (bTask1 === bTask2) return t1 < t2 ? t1 : t2;
        return bTask1 > bTask2 ? t1 : t2;
    }
    return aTask1 > aTask2 ? t2 : t1;
  };

  const finalATask = decideTask(A.person_id, B.person_id);

  // 5. B pega a outra tarefa
  const finalBTask = finalATask === t1 ? t2 : t1;

  // 6. Montar e retornar os 2 Designated { data, task_id, person_id, status:'pending', __row }
  const autoTaskA: Designated = {
    data,
    task_id: finalATask,
    person_id: A.person_id,
    status: 'pending',
  };

  const autoTaskB: Designated = {
    data, 
    task_id: finalBTask,
    person_id: B.person_id,
    status: 'pending',
  };

  return [autoTaskA, autoTaskB];
}