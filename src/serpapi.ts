// Único módulo que fala com a SerpApi (Google Flights, engine google_flights — busca exata,
// não usa o engine "deals" porque aquele só retorna achados com desconto sinalizado pelo Google,
// não é um price-checker geral).
import axios from 'axios';
import { env } from './config';
import { logger } from './logger';

const SEARCH_URL = 'https://serpapi.com/search';

// Retorna o menor preço encontrado para a rota/data exata (one-way), ou null em qualquer falha (fail-safe).
export async function searchFlightPrice(
  origem: string,
  destino: string,
  data: string,
  moeda: string,
): Promise<number | null> {
  try {
    const res = await axios.get(SEARCH_URL, {
      params: {
        engine: 'google_flights',
        departure_id: origem,
        arrival_id: destino,
        outbound_date: data,
        type: 2, // one-way
        currency: moeda,
        hl: 'pt',
        api_key: env.SERPAPI_KEY,
      },
      timeout: 20_000,
    });
    const voos = [...(res.data?.best_flights ?? []), ...(res.data?.other_flights ?? [])] as Array<{
      price?: number;
    }>;
    const prices = voos.map((v) => Number(v.price)).filter((p) => Number.isFinite(p));
    if (prices.length === 0) return null;
    return Math.min(...prices);
  } catch (err) {
    logger.error('Falha ao buscar preço na SerpApi', {
      origem,
      destino,
      data,
      error: (err as Error).message,
    });
    return null;
  }
}
