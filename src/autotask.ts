import { countReset } from "console";
import { addDays } from "./time";
import type { AutoTask, Designated, Designation } from "./types";

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