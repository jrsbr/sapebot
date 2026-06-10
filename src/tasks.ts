// Regras de negócio puras (sem I/O), tipos do domínio e formatação de mensagens.
import { normalizeText } from './parser';
import { daysBetween } from './time';
import type { Person, Task } from './types'


// ===== Telefone =====

export function onlyDigits(s: string): string {
  return (s ?? '').replace(/\D/g, '');
}

// Chave canônica para números BR (55 + DDD de 2 + 9 dígitos = 13).
// Remove o nono dígito quando presente, para casar com/sem o 9.
export function brPhoneKey(phone: string): string {
  let d = onlyDigits(phone);
  if (d.length === 13 && d.startsWith('55') && d[4] === '9') {
    d = d.slice(0, 4) + d.slice(5); // remove o 9 após 55+DDD
  }
  return d;
}

export function findPersonByPhone(people: Person[], phone: string): Person | undefined {
  const key = brPhoneKey(phone);
  if (!key) return undefined;
  return people.find((p) => brPhoneKey(p.whatsapp_e164) === key);
}

// ===== Seleção de tarefas =====

function isPausedBySkip(task: Task, today: string): boolean {
  if (!task.skip_until) return false;
  // Pausada se skip_until for hoje ou no futuro.
  return task.skip_until >= today;
}

function isDue(task: Task, today: string): boolean {
  if (!task.data) return true;
  return task.data <= today;
}

// Lista de tarefas do dia para uma pessoa, ordenada de forma determinística
// (por task_id) — é o que garante que "feito 1" case com o "1" do lembrete.
export function getPendingTasksForToday(tasks: Task[], personId: string, today: string): Task[] {
  return tasks
    .filter(
      (t) =>
        t.person_id === personId &&
        t.status === 'pending' &&
        t.cobrar === true &&
        !isPausedBySkip(t, today) &&
        isDue(t, today),
    )
    .sort((a, b) => a.task_id.localeCompare(b.task_id));
}

// Virada de recorrentes: tarefas daily/weekly cuja instância ficou no passado
// voltam para "pending" hoje. Mutaciona os objetos recebidos e retorna os alterados.
export function rolloverRecurringTasks(tasks: Task[], today: string): Task[] {
  const changed: Task[] = [];
  for (const t of tasks) {
    if (t.status === 'cancelled') continue;
    if (t.periodicidade === 'once') continue;
    if (!t.data) continue; // sem data não há como decidir a virada
    if (t.data >= today) continue; // já está no dia atual ou no futuro

    let due = false;
    if (t.periodicidade === 'daily') {
      due = true;
    } else if (t.periodicidade === 'weekly') {
      due = daysBetween(t.data, today) >= 7;
    }
    if (!due) continue;

    t.data = today;
    t.status = 'pending';
    t.cobrar = true;
    t.completed_at = '';
    t.skip_until = '';
    changed.push(t);
  }
  return changed;
}

// ===== Atualizações de tarefa =====

export function markDone(task: Task, when: string): Task {
  task.status = 'done';
  task.completed_at = when;
  task.cobrar = false;
  return task;
}

export function markSkippedForToday(task: Task, today: string): Task {
  task.status = 'skipped';
  task.skip_until = today;
  task.cobrar = false;
  return task;
}

// Compara a distância entre duas strings
function damerauLevenshtein(
  A: string,
  B: string,
): number {
  const sizeA = A.length;
  const sizeB = B.length;
  const dp: number[][] = Array.from({ length: sizeA + 1}, () => new Array(sizeB + 1).fill(0));
  for(let i = 0; i <= sizeA; i ++) dp[i][0] = i;
  for(let j = 0; j <= sizeB; j ++) dp[0][j] = j;
  
  for(let i = 1; i <= sizeA; i++) {
    for(let j = 1; j <= sizeB; j++){
      const cost = A[i - 1] === B[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && A[i - 1] === B[j - 2] && A[i - 2] === B[j - 1]) dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
    }
  }
  return dp[sizeA][sizeB];
}

function stringSimilarity(
  A: string,
  B: string,
): number {
  const maxSize = Math.max(A.length, B.length);
  const dist = damerauLevenshtein(A, B);
  if (maxSize === 0) return 1; // Strings vazias
  return 1 - dist/maxSize;
}

export function findPersonByIdOrName(
  people: Person[],
  query: string,
): { match?: Person; ambiguous: Person[] } {
  const q = normalizeText(query);
  if(!q) return { ambiguous: [] };

  const scored = people
    .map((p) => {
      const pName = normalizeText(p.nome);
      const pId = normalizeText(p.person_id);
      const sim = stringSimilarity(q, pName);
      let score = 0;
      if (q === pName || q === pId) score = 100;
      else if (pName.includes(q)) score = 60;
      else if (q.includes(pName)) score = 40;
      else if (sim > 0.85) score = Math.round(sim * 50);
      return { person: p, score};
    }
  )
  .filter((p) => p.score > 0)
  .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { ambiguous: [] };
  if (scored.length === 1 || scored[0].score > scored[1].score) return { match: scored[0].person, ambiguous: []};
  
  const top = scored.filter((s) => s.score === scored[0].score).map((s) => s.person);
  return { ambiguous: top };
}

// ===== Idempotência =====

export function dedupeByRow(tasks: Task[]): Task[] {
  const map = new Map<number, Task>();
  for (const t of tasks) map.set(t.__row, t);
  return [...map.values()];
}