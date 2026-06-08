import type { AutoTask, Designated, Designation } from "./types";

function isDesignatedThisDay (
    designated: Designated[],
    task_id: string,
    date: string,
): boolean {
    return designated.some((d) => (date === d.data && task_id === d.task_id));
}

export function findNextDesignated (
    designations: Designation[],
    designateds: Designated[],
    date: string,
): Designated {
    const sortedByCount = designations.map((d) => ({ taskId: d.task_id, name: d.person_id, count: d.count })).sort((a,b) => a.count - b.count);

}