export function parseConfig(env: Record<string, string | undefined>) {
  const source = env.VITE_DATA_SOURCE === 'mock' ? 'mock' : 'api';
  const base = (env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');
  if (!base.startsWith('/') && !/^https?:\/\//.test(base)) throw new Error('La URL pública del backend debe ser HTTP(S) o una ruta relativa.');
  const parsed = new URL(base, 'http://localhost');
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('La URL pública no debe incluir credenciales ni parámetros.');
  return { source, base } as const;
}
