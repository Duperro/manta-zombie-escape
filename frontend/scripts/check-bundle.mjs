import fs from 'node:fs';
import path from 'node:path';
const files = fs.readdirSync('dist', { recursive: true }).map(String).filter(f => fs.statSync(path.join('dist', f)).isFile());
const forbidden = [/x-api-key/i, /API_KEY/, /phase3-release-only/, /example-capture-only/];
for (const file of files) {
  const text = fs.readFileSync(path.join('dist', file), 'utf8');
  if (forbidden.some(pattern => pattern.test(text))) throw new Error(`Private backend credential marker in ${file}`);
}
console.log('Bundle check: no backend credential markers or private request headers.');
