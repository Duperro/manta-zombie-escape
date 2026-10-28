import type { Point, PreparedMap, Street } from '../types/visual';

export interface TraversedEdge { from: string; to: string; id: string }

export function readTraversedEdges(records: Array<Record<string, unknown>>): TraversedEdge[] {
  return records.flatMap(record =>
    typeof record.origen === 'string' && typeof record.destino === 'string' && typeof record.aristaId === 'string'
      ? [{ from: record.origen, to: record.destino, id: record.aristaId }]
      : []);
}

function squareDistance(a: Point, b: Point): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
}

function streetPoints(street: Street, map: PreparedMap): Point[] {
  const from = map.nodes.get(street.from);
  const to = map.nodes.get(street.to);
  if (!from || !to || street.points.length < 2) return [];
  const first = street.points[0];
  const last = street.points[street.points.length - 1];
  const reversed = squareDistance(first, to) + squareDistance(last, from) <
    squareDistance(first, from) + squareDistance(last, to);
  return [from, ...(reversed ? [...street.points].reverse() : street.points), to];
}

export function movementPath(
  from: string, to: string, kind: 'person' | 'zombie' | 'runner' | 'truck',
  map: PreparedMap, blocked: Set<string>, traversed: TraversedEdge[] = [],
): Point[] {
  if (from === to) return [];
  // A runner can cross two edges in one turn; it needs the exact published trace.
  if (kind === 'runner' && !traversed.length) return [];
  if (kind === 'truck' || kind === 'runner' || (kind === 'zombie' && traversed.length > 0)) {
    if (!traversed.length || traversed[0].from !== from || traversed[traversed.length - 1].to !== to) return [];
    const points: Point[] = [];
    let current = from;
    for (const step of traversed) {
      if (step.from !== current) return [];
      const street = map.streets.find(edge => edge.id === step.id && edge.from === step.from && edge.to === step.to);
      if (!street) return [];
      const segment = streetPoints(street, map);
      if (segment.length < 2) return [];
      points.push(...(points.length ? segment.slice(1) : segment));
      current = step.to;
    }
    return points;
  }
  const street = map.pairs.get(`${from}\0${to}`)?.find(edge => !edge.blocked && !blocked.has(edge.id));
  return street ? streetPoints(street, map) : [];
}
