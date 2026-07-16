// Regras puras de decisão de alerta e relatório do flight tracker. Sem I/O.
import type { FlightRoute, FlightAlertDecision } from './types';
import { addDays, daysBetween } from './time';

export function formatMoney(valor: number, moeda: string): string {
  return `${moeda} ${valor.toFixed(2)}`;
}

function routeLabel(route: FlightRoute, dataAlvo: string): string {
  return `${route.origem} → ${route.destino} (${dataAlvo})`;
}

// Escolhe qual data da faixa [dataInicio, dataFim] checar hoje, ciclando um dia por vez.
// dataInicio === dataFim (rota de data fixa) sempre retorna a mesma data.
export function pickDateForToday(route: FlightRoute, today: string): string {
  const span = Math.max(0, daysBetween(route.dataInicio, route.dataFim));
  if (span === 0) return route.dataInicio;
  const elapsed = daysBetween(route.dataInicio, today);
  const offset = ((elapsed % (span + 1)) + (span + 1)) % (span + 1);
  return addDays(route.dataInicio, offset);
}

export function decideAlert(route: FlightRoute, dataAlvo: string, precoAtual: number): FlightAlertDecision {
  const label = routeLabel(route, dataAlvo);
  const isNewBest = route.melhorAteAgora === null || precoAtual < route.melhorAteAgora;

  if (isNewBest) {
    const antes =
      route.melhorAteAgora !== null ? formatMoney(route.melhorAteAgora, route.moeda) : 'sem histórico';
    return {
      kind: 'novo_melhor',
      isNewBest: true,
      message: `Novo melhor preço! ${label}: ${formatMoney(precoAtual, route.moeda)} (antes: ${antes})`,
    };
  }
  if (precoAtual <= route.thresholdBom) {
    return {
      kind: 'abaixo_sempre',
      isNewBest: false,
      message: `${label}: ${formatMoney(precoAtual, route.moeda)} — abaixo do limite bom (${formatMoney(route.thresholdBom, route.moeda)}).`,
    };
  }
  if (precoAtual >= route.thresholdCaro) {
    return {
      kind: 'caro',
      isNewBest: false,
      message: `${label}: ${formatMoney(precoAtual, route.moeda)} — tá caro (limite: ${formatMoney(route.thresholdCaro, route.moeda)}).`,
    };
  }
  return { kind: 'nada', isNewBest: false, message: '' };
}

// Linha do resumo diário consolidado. Se houve alerta (kind !== 'nada'), usa a mensagem do alerta
// (já contém rota + preço); senão, uma linha simples com preço atual e melhor até agora.
export function buildRouteLine(
  route: FlightRoute,
  dataAlvo: string,
  precoAtual: number,
  decision: FlightAlertDecision,
): string {
  if (decision.kind !== 'nada') return decision.message;
  const melhor = route.melhorAteAgora !== null ? formatMoney(route.melhorAteAgora, route.moeda) : formatMoney(precoAtual, route.moeda);
  return `${routeLabel(route, dataAlvo)}: ${formatMoney(precoAtual, route.moeda)} (melhor até agora: ${melhor})`;
}
