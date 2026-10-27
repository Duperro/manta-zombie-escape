// The production build is public/read-only. The Vite proxy exists only in dev.
export function localOperatorControlsEnabled(): boolean {
  return import.meta.env.DEV;
}
