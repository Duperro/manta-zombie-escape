// Capa de depuración de dormidos: solo en desarrollo local (revela información oculta).
export function localOperatorControlsEnabled(): boolean {
  return import.meta.env.DEV;
}

// El botón "Pruebas de fuego" se muestra siempre. En producción pide la clave de
// operador (API key) y el backend la valida en cada petición de control.
export function fireTestControlsEnabled(): boolean {
  return true;
}
