import * as THREE from 'three';

/** Posición a lo largo de una polilínea según la fracción recorrida (0..1). */
export function alongPath(path: THREE.Vector3[], fraction: number): { position: THREE.Vector3; direction: THREE.Vector3 | null } {
  if (path.length === 0) return { position: new THREE.Vector3(), direction: null };
  if (path.length === 1) return { position: path[0].clone(), direction: null };
  const lengths = path.slice(1).map((p, i) => p.distanceTo(path[i]));
  const total = lengths.reduce((a, b) => a + b, 0);
  let remaining = total * Math.max(0, Math.min(1, fraction));
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] || i === lengths.length - 1) {
      const share = lengths[i] ? Math.min(1, remaining / lengths[i]) : 1;
      const direction = new THREE.Vector3().subVectors(path[i + 1], path[i]);
      return { position: path[i].clone().lerp(path[i + 1], share), direction: direction.lengthSq() > 0 ? direction.normalize() : null };
    }
    remaining -= lengths[i];
  }
  return { position: path[path.length - 1].clone(), direction: null };
}

/** Lo que queda de una polilínea desde la fracción recorrida (incluye el punto actual). */
export function restOfPath(path: THREE.Vector3[], fraction: number): THREE.Vector3[] {
  if (path.length < 2) return path.slice();
  const lengths = path.slice(1).map((p, i) => p.distanceTo(path[i]));
  const total = lengths.reduce((a, b) => a + b, 0);
  let remaining = total * Math.max(0, Math.min(1, fraction));
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i]) {
      const share = lengths[i] ? remaining / lengths[i] : 1;
      return [path[i].clone().lerp(path[i + 1], share), ...path.slice(i + 1)];
    }
    remaining -= lengths[i];
  }
  return [path[path.length - 1].clone()];
}

export function pathLength(path: THREE.Vector3[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += path[i].distanceTo(path[i - 1]);
  return total;
}
