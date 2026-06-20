import { addDays } from "./time";
import type { Person, AutoTask, Designated } from "./types";

export function expiredPendingDesignated (
    designateds: Designated[],
    logicalDate: string,
): Designated[] {
    return designateds.filter((d) => (d.status === 'pending' && logicalDate > d.data));
}

export function countInWindow (
    designateds: Designated[],
    person_id: string,
    cut: string,
): { done: number, missed: number, pending: number } {
    const personTasks = designateds.filter((d) => d.person_id === person_id && d.data >= cut);
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
    return (done + 2 * pending) / (done + 2 * pending + missed + 3)
}

export function countDoneByTaskPerson (
    designateds: Designated[],
    person_id: string,
    task_id: string,
    cut: string,
): number {
    const total = designateds.filter((d) => 
        d.person_id === person_id &&
        d.task_id === task_id &&
        d.status === 'done' &&
        d.data >= cut
        ).length;
    return total;
}

export function selectDayAssignments(
  pool: Person[],           
  autoTasks: AutoTask[], 
  designated: Designated[], 
  data: string,    
  cut: string,        
): Designated[] {
  if (pool.length < 2) return [];
  let metrics = pool.map((p) => {
    const { done, missed, pending } = countInWindow(designated, p.person_id,cut);
    return { person_id: p.person_id, done, pending, rate: successRate(done, missed, pending) };
    })

  const A = metrics.sort((a, b) => 
    a.done + a.pending - b.done - b.pending ||
    a.rate - b.rate ||
    a.person_id.localeCompare(b.person_id))[0];

  const rateSorted = metrics.sort((a, b) => 
    a.rate - b.rate ||
    a.done + a.pending - b.done - b.pending ||
    a.person_id.localeCompare(b.person_id));
  let B = rateSorted[0];
  if (B.person_id === A.person_id) B = rateSorted[1];

  const t1 = autoTasks[0].task_id;
  const t2 = autoTasks[1].task_id;
  const decideTask = (
    firstPerson: string,
    secondPerson: string,
  ): string => {
    const aTask1 = countDoneByTaskPerson(designated, firstPerson, t1, cut);
    const aTask2 = countDoneByTaskPerson(designated, firstPerson, t2, cut);
    if (aTask1 === aTask2) {
        const bTask1 = countDoneByTaskPerson(designated, secondPerson, t1, cut);
        const bTask2 = countDoneByTaskPerson(designated, secondPerson, t2, cut);
        if (bTask1 === bTask2) return t1 < t2 ? t1 : t2;
        return bTask1 > bTask2 ? t1 : t2;
    }
    return aTask1 > aTask2 ? t2 : t1;
  };

  const finalATask = decideTask(A.person_id, B.person_id);
  const finalBTask = finalATask === t1 ? t2 : t1;
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

export function fullWeekAssignments(
  pool: Person[],           
  autoTasks: AutoTask[], 
  designated: Designated[], 
  data: string,    
  cut: string,   
): { newDesignated: Designated[], partialDays: string[] }{
    const working = [...designated];
    const newDesignated: Designated[] = [];
    const tasksId = autoTasks.map((a) => a.task_id);
    let partialDays: string[] = [];
    const tasksFromDay = (
        day: string,
    ): string[] => {
        return working.filter((d) => d.data === day).map((d) => d.task_id);
    }
    for (let i = 0 ; i < 7 ; i ++) {
        const futureDate = addDays(data, i);
        const dayTasksId = tasksFromDay(futureDate);
        const missingTasks = tasksId.filter((t) => !dayTasksId.includes(t));
        if (missingTasks.length === 0) continue;
        if (missingTasks.length < tasksId.length) {
            partialDays.push(futureDate);
            continue;
        }
        const dayDesignated = selectDayAssignments(pool, autoTasks, working, futureDate, cut);
        working.push(...dayDesignated);
        newDesignated.push(...dayDesignated);
    }
    return { newDesignated, partialDays };
}

export function getPendingAutoForToday(
    designated: Designated[],
    person_id: string,
    logicalToday: string,
): Designated[] {
    return designated.filter((d) =>
        person_id === d.person_id &&
        logicalToday === d.data &&
        d.status === 'pending'
    );
}

export function vacationPendingToDelete(
  designated: Designated[], 
  person_id: string, 
  fromDate: string,
): Designated[] {
  const affectedDays = new Set(
    designated.filter((d) => 
      d.data >= fromDate && 
      d.status === 'pending'&&
      d.person_id === person_id
    )
    .map((d) => d.data)
  );
  const affectedDesignated = designated.filter((d) =>
    d.status === 'pending' &&
    affectedDays.has(d.data)
  );
  return affectedDesignated;
}

export function missedInWindow(
  designated: Designated[], 
  fromDate: string
): Designated[] {
  return designated.filter((d) => 
    d.data >= fromDate &&
    d.status === 'missed'
  )
  .sort((a,b) =>
    a.data.localeCompare(b.data) ||
    a.person_id.localeCompare(b.person_id)
  );
}