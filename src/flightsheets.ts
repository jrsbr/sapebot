// Único módulo que fala com a planilha do flight tracker (separada da planilha da casa).
import { google, sheets_v4 } from 'googleapis';
import { env } from './config';
import type { FlightRoute, FlightPriceLog } from './types';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

export const FLIGHT_TAB = {
  rotas: 'Rotas',
  precos: 'Precos',
} as const;

const ROTAS_HEADER = [
  'origem', 'destino', 'data_inicio', 'data_fim', 'moeda', 'threshold_bom', 'threshold_caro', 'melhor_ate_agora', 'ativo',
];
const PRECOS_HEADER = ['timestamp', 'origem', 'destino', 'data', 'preco', 'moeda'];

let client: sheets_v4.Sheets | null = null;
const headerCache: Record<string, string[]> = {};

function getClient(): sheets_v4.Sheets {
  if (client) return client;
  const auth = new google.auth.JWT({
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: env.GOOGLE_PRIVATE_KEY,
    scopes: SCOPES,
  });
  client = google.sheets({ version: 'v4', auth });
  return client;
}

function colLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function toBool(v: string): boolean {
  const s = String(v ?? '').trim().toUpperCase();
  return s === 'TRUE' || s === '1' || s === 'SIM' || s === 'VERDADEIRO';
}
function boolStr(b: boolean): string {
  return b ? 'TRUE' : 'FALSE';
}

interface RawTable {
  header: string[];
  rows: { __row: number; values: Record<string, string> }[];
}

async function loadTable(tab: string): Promise<RawTable> {
  const c = getClient();
  const res = await c.spreadsheets.values.get({
    spreadsheetId: env.FLIGHTS_SPREADSHEET_ID,
    range: tab,
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const matrix = (res.data.values ?? []) as unknown[][];
  if (matrix.length === 0) return { header: [], rows: [] };

  const header = (matrix[0] ?? []).map((h) => String(h ?? '').trim());
  const rows = matrix.slice(1).map((arr, idx) => {
    const values: Record<string, string> = {};
    header.forEach((h, i) => {
      values[h] = arr[i] == null ? '' : String(arr[i]);
    });
    return { __row: idx + 2, values };
  });
  return { header, rows };
}

function ensureHeader(tab: string, fallback: string[]): string[] {
  return headerCache[tab] && headerCache[tab].length ? headerCache[tab] : fallback;
}

async function writeRow(
  tab: string,
  header: string[],
  rowNumber: number,
  values: Record<string, string>,
): Promise<void> {
  const c = getClient();
  const arr = header.map((h) => values[h] ?? '');
  await c.spreadsheets.values.update({
    spreadsheetId: env.FLIGHTS_SPREADSHEET_ID,
    range: `${tab}!A${rowNumber}:${colLetter(header.length)}${rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [arr] },
  });
}

function routeToValues(r: FlightRoute): Record<string, string> {
  return {
    origem: r.origem,
    destino: r.destino,
    data_inicio: r.dataInicio,
    data_fim: r.dataFim,
    moeda: r.moeda,
    threshold_bom: String(r.thresholdBom),
    threshold_caro: Number.isFinite(r.thresholdCaro) ? String(r.thresholdCaro) : '',
    melhor_ate_agora: r.melhorAteAgora !== null ? String(r.melhorAteAgora) : '',
    ativo: boolStr(r.ativo),
  };
}

function priceLogToValues(p: FlightPriceLog): Record<string, string> {
  return {
    timestamp: p.timestamp,
    origem: p.origem,
    destino: p.destino,
    data: p.data,
    preco: String(p.preco),
    moeda: p.moeda,
  };
}

export async function loadRoutes(): Promise<FlightRoute[]> {
  const { header, rows } = await loadTable(FLIGHT_TAB.rotas);
  headerCache[FLIGHT_TAB.rotas] = header;
  return rows
    .filter((r) =>
      (r.values['origem'] ?? '').trim() !== '' &&
      (r.values['destino'] ?? '').trim() !== '' &&
      (r.values['data_inicio'] ?? '').trim() !== '',
    )
    .map((r) => {
      const dataInicio = (r.values['data_inicio'] ?? '').trim();
      const dataFim = (r.values['data_fim'] ?? '').trim() || dataInicio;
      return {
      __row: r.__row,
      origem: (r.values['origem'] ?? '').trim().toUpperCase(),
      destino: (r.values['destino'] ?? '').trim().toUpperCase(),
      dataInicio,
      dataFim,
      moeda: (r.values['moeda'] ?? '').trim().toUpperCase() || 'BRL',
      thresholdBom: Number(r.values['threshold_bom']) || 0,
      thresholdCaro:
        (r.values['threshold_caro'] ?? '').trim() !== '' ? Number(r.values['threshold_caro']) : Infinity,
      melhorAteAgora:
        (r.values['melhor_ate_agora'] ?? '').trim() !== '' ? Number(r.values['melhor_ate_agora']) : null,
      ativo: toBool(r.values['ativo']),
      };
    });
}

export async function updateBestPrice(route: FlightRoute): Promise<void> {
  const header = ensureHeader(FLIGHT_TAB.rotas, ROTAS_HEADER);
  await writeRow(FLIGHT_TAB.rotas, header, route.__row, routeToValues(route));
}

export async function appendPriceLog(entry: FlightPriceLog): Promise<void> {
  const header = ensureHeader(FLIGHT_TAB.precos, PRECOS_HEADER);
  const c = getClient();
  await c.spreadsheets.values.append({
    spreadsheetId: env.FLIGHTS_SPREADSHEET_ID,
    range: `${FLIGHT_TAB.precos}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [header.map((h) => priceLogToValues(entry)[h] ?? '')] },
  });
}
