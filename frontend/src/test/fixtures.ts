import fs from 'node:fs';
import path from 'node:path';
import { decodeMap, decodeState } from '../services/decode';
const demo = path.resolve(process.cwd(), 'public/demo');
export const mapFixture = decodeMap(JSON.parse(fs.readFileSync(path.join(demo, 'mapa.json'), 'utf8')));
export const frameFixtures = (JSON.parse(fs.readFileSync(path.join(demo, 'round_3.json'), 'utf8')) as { frames: unknown[] }).frames.map(decodeState);
export const clone = <T,>(value: T): T => structuredClone(value);
export const reply = (data: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => clone(data) }) as Response;
