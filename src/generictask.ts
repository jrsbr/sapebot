import type { GenericTask, Task, AutoTask } from "./types";

export function sortGenericTask(
    tasks: GenericTask[],
): GenericTask[] {
    return [...tasks].sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'normal' ? -1 : 1;
        return a.task_id.localeCompare(b.task_id);
    }
    );
}