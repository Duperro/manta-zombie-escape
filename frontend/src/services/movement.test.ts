import { describe, expect, it } from 'vitest';
import { movementPath, readTraversedEdges } from './movement';
import type { PreparedMap, Street } from '../types/visual';

const streets: Street[] = [
  { id: 'A-B', from: 'A', to: 'B', points: [[0, 0], [0.4, 0], [0.4, 1], [0, 1]], cost: 1, type: 'calle', blocked: false },
  { id: 'B-C', from: 'B', to: 'C', points: [[0, 1], [0.4, 1.5], [0, 2]], cost: 1, type: 'calle', blocked: false },
];
const map: PreparedMap = {
  version: 'test', attribution: '', nodes: new Map([['A', [0, 0]], ['B', [0, 1]], ['C', [0, 2]]]),
  streets, pairs: new Map([['A\0B', [streets[0]]], ['B\0C', [streets[1]]]]), bounds: [],
};

describe('visual movement on real street geometry', () => {
  it('follows a curved street instead of crossing directly between nodes', () => {
    expect(movementPath('A', 'B', 'person', map, new Set())).toContainEqual([0.4, 0]);
    expect(movementPath('A', 'B', 'zombie', map, new Set())).toContainEqual([0.4, 1]);
  });

  it('uses the exact sequence of streets reported for a vehicle', () => {
    const traversed = readTraversedEdges([
      { origen: 'A', destino: 'B', aristaId: 'A-B' },
      { origen: 'B', destino: 'C', aristaId: 'B-C' },
    ]);
    const path = movementPath('A', 'C', 'truck', map, new Set(), traversed);
    expect(path[0]).toEqual([0, 0]);
    expect(path).toContainEqual([0.4, 0]);
    expect(path).toContainEqual([0.4, 1.5]);
    expect(path.at(-1)).toEqual([0, 2]);
    expect(movementPath('A', 'C', 'runner', map, new Set(), traversed)).toEqual(path);
    expect(movementPath('A', 'C', 'truck', map, new Set(), traversed.slice(1))).toEqual([]);
  });

  it('does not invent a route through a blocked edge or for a runner with an unknown intermediate node', () => {
    expect(movementPath('A', 'B', 'person', map, new Set(['A-B']))).toEqual([]);
    expect(movementPath('A', 'C', 'runner', map, new Set())).toEqual([]);
  });
});
