import type { GenericTask, Task, AutoTask, Designated } from "./types";

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

export function designatedToGeneric(
    designated: Designated,
    autoTask: AutoTask[],
): GenericTask {
    const desc = autoTask.find((a) => a.task_id === designated.task_id)?.descricao ?? '';
    const generic: GenericTask = {
        task_id: designated.task_id,
        descricao: desc,
        data: designated.data,
        person_id: designated.person_id,
        kind: 'auto',
        status: designated.status
    };
    return generic;
}

export function buildCombinedList(
    tasks: Task[], // already filtered
    designated: Designated[], // already filtered
    autoTasks: AutoTask[], 
): GenericTask[] {
    const normalToGnr = tasks.map((t) => taskToGeneric(t));
    const autoToGnr = designated.map((d) => designatedToGeneric(d, autoTasks));
    return sortGenericTask([...normalToGnr,...autoToGnr]);
}

export function genericTaskKey (
    genTask: GenericTask[],
): string {
    const sortedIds = genTask.map((g) => g.task_id).sort((a, b) => a.localeCompare(b));
    return sortedIds.join(',')
}