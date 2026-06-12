import { unknown } from "zod";
import type { Intent } from "./types";

// Normaliza texto: minúsculas, sem acentos, espaços colapsados.
export function normalizeText(s: string): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

const DONE_WORDS = [
  'feito', 'feita', 'feitos', 'feitas',
  'concluido', 'concluida', 'concluidos', 'concluidas', 'concluir',
  'pronto', 'pronta', 'prontos', 'prontas',
];
const SKIP_WORDS = ['pular', 'pula', 'pulei', 'skip', 'adiar', 'adia'];
const STATUS_WORDS = ['status', 'situacao', 'pendentes', 'pendente', 'faltam', 'falta'];
const HELP_WORDS = ['ajuda', 'help', 'comandos', 'comando', '?'];

export function parseMessage(text: string): Intent {
  const raw = text ?? '';
  const norm = normalizeText(raw);
  if (!norm) return { type: 'unknown', raw };

  const tokens = norm.split(' ');
  const first = tokens[0];
  const rest = norm.slice(first.length).trim();

  if (first === 'admin') return { type: 'admin', raw }; 
  if (HELP_WORDS.includes(first)) return { type: 'help' };
  if (STATUS_WORDS.includes(first)) return { type: 'status' };
  if (DONE_WORDS.includes(first)) return buildActionIntent('done', rest);
  if (SKIP_WORDS.includes(first)) return buildActionIntent('skip', rest);
  if (first === 'ferias') {
    if (rest === '') return { type: 'ferias_on' };
  }
  if (first === 'voltar' && rest === 'ferias') {
    return { type: 'ferias_off' };
  }
  if (first === 'confirmar') {
    if (rest === 'ferias') return { type: 'ferias_on_confirm' };
    if (rest === 'voltar ferias') return { type: 'ferias_off_confirm' };
  }
  if (first === 'semana' && rest === '') return { type: 'calendar' };
  if (/^bom\s?dia+\b/.test(norm)) return { type: 'bomdia' };

  return { type: 'unknown', raw };
}

// Monta o Intent dos tipos 'done' e 'skip', levando em conta se usam
// indice ou uma descricao
function buildActionIntent(type: 'done' | 'skip', rest: string): Intent {
  if (!rest) return { type }; // "feito" / "pular" sem argumento
  const indices = parseIndices(rest);
  if (indices.length > 0) return { type, indices };
  // texto livre: "feito lavar louça"
  return { type, query: rest };
}

// Extrai números de "1", "1,2", "1 2", "1, 2 e 3".
function parseIndices(s: string): number[] {
  const matches = s.match(/\d+/g);
  if (!matches) return [];
  const nums = matches
    .map((m) => parseInt(m, 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  return [...new Set(nums)]; // remove duplicatas preservando ordem
}