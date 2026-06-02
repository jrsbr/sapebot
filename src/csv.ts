// Exportação/importação de CSV. O Google Sheets continua sendo a fonte da verdade;
// o CSV serve para backup e edição offline pontual.
//
// Uso:
//   npm run csv:export                         -> exporta todas as abas para ./csv-export/
//   npm run csv:import -- Tarefas arquivo.csv  -> SUBSTITUI o conteúdo da aba pelo CSV
import fs from 'fs';
import path from 'path';
import { logger } from './logger';
import { dumpTab, overwriteTab, TAB } from './sheets';

const ALL_TABS = [TAB.pessoas, TAB.tarefas, TAB.mensagens, TAB.config];

function escapeCsv(value: string): string {
  const v = value ?? '';
  if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function toCsv(matrix: string[][]): string {
  return matrix.map((row) => row.map(escapeCsv).join(',')).join('\r\n');
}

// Parser CSV simples no estilo RFC 4180 (lida com aspas e vírgulas dentro de campos).
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      pushField();
      i++;
      continue;
    }
    if (c === '\r') {
      i++;
      continue;
    }
    if (c === '\n') {
      pushField();
      pushRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    pushField();
    pushRow();
  }
  return rows;
}

export async function exportAllTabs(dir: string): Promise<void> {
  fs.mkdirSync(dir, { recursive: true });
  for (const tab of ALL_TABS) {
    const matrix = await dumpTab(tab);
    const file = path.join(dir, `${tab}.csv`);
    fs.writeFileSync(file, toCsv(matrix), 'utf8');
    logger.info(`Exportado: ${file} (${matrix.length} linhas)`);
  }
}

export async function importCsvToTab(tab: string, file: string): Promise<void> {
  const text = fs.readFileSync(file, 'utf8');
  const matrix = parseCsv(text);
  await overwriteTab(tab, matrix);
  logger.info(`Importado ${file} para a aba "${tab}" (${matrix.length} linhas).`);
}

async function cli(): Promise<void> {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'export') {
    await exportAllTabs(a || path.join(process.cwd(), 'csv-export'));
    return;
  }
  if (cmd === 'import') {
    if (!a || !b) {
      console.error('Uso: npm run csv:import -- <NomeDaAba> <arquivo.csv>');
      process.exit(1);
    }
    await importCsvToTab(a, b);
    return;
  }
  console.error('Comandos: export | import <aba> <arquivo.csv>');
  process.exit(1);
}

if (require.main === module) {
  cli()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}