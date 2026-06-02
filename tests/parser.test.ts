import { describe, it, expect } from 'vitest';
import { parseMessage } from '../src/parser';

describe('parseMessage', () => {
  it('reconhece "feito" simples', () => {
    expect(parseMessage('feito')).toEqual({ type: 'done' });
  });

  it('reconhece "feito 1"', () => {
    expect(parseMessage('feito 1')).toEqual({ type: 'done', indices: [1] });
  });

  it('reconhece "feito 1,2"', () => {
    expect(parseMessage('feito 1,2')).toEqual({ type: 'done', indices: [1, 2] });
  });

  it('reconhece "feito 1 e 3"', () => {
    expect(parseMessage('feito 1 e 3')).toEqual({ type: 'done', indices: [1, 3] });
  });

  it('reconhece "feito lavar louça" como texto', () => {
    expect(parseMessage('feito lavar louça')).toEqual({ type: 'done', query: 'lavar louca' });
  });

  it('reconhece "pular 1"', () => {
    expect(parseMessage('pular 1')).toEqual({ type: 'skip', indices: [1] });
  });

  it('reconhece "status"', () => {
    expect(parseMessage('status')).toEqual({ type: 'status' });
  });

  it('reconhece "ajuda"', () => {
    expect(parseMessage('ajuda')).toEqual({ type: 'help' });
  });

  it('ignora maiúsculas, espaços e acentos', () => {
    expect(parseMessage('  FEITO  ')).toEqual({ type: 'done' });
    expect(parseMessage('Concluído')).toEqual({ type: 'done' });
  });

  it('marca como desconhecido quando não entende', () => {
    expect(parseMessage('bom dia, tudo bem?').type).toBe('unknown');
  });

  it('mensagem vazia é desconhecida', () => {
    expect(parseMessage('').type).toBe('unknown');
  });
});