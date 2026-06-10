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

export function taskToGeneric(
    task: Task,
): GenericTask {
    const generic: GenericTask = {
        task_id: task.task_id,
        descricao: task.descricao,
        data: task.data,
        person_id: task.person_id,
        kind: 'normal',
        status: task.status
    };
    return generic;
}