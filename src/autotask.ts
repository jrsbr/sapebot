import type { AutoTask, Designated, Designation } from "./types";

function isDesignatedThisDay (
    designateds: Designated[],
    task_id: string,
    date: string,
): boolean {
    return designateds.some((d) => (date === d.data && task_id === d.task_id));
}

function isAssignedThisDay (
    designateds: Designated[],
    person_id: string,
    date: string,
): boolean {}

// terminar
export function findNextDesignated (
    designations: Designation[],
    designateds: Designated[],
    autoTask: AutoTask[],
    date: string,
): Designated {
    const sortedByCount = designations.map((d) => ({ taskId: d.task_id, name: d.person_id, count: d.count })).sort((a,b) => a.count - b.count);
    const taskIds  = autoTask.map((a) => a.task_id);
    let freeTask = ''
    for (let i in taskIds) {
        if (isDesignatedThisDay(designateds, i, date)) {
            freeTask = i;
            break
        }
    }
}

export function expiredPendingDesignated (
    designateds: Designated[],
    logicalDate: string,
): Designated[] {
    return designateds.filter((d) => (d.status === 'pending' && logicalDate > d.data));
}