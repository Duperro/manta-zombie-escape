import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { SimulationProvider } from '../providers/SimulationProvider';
const Context = createContext<SimulationProvider | null>(null);
export function SimulationContext({ provider, children }: { provider: SimulationProvider; children: ReactNode }) {
  useEffect(() => { provider.start(); return () => provider.stop(); }, [provider]);
  return <Context.Provider value={provider}>{children}</Context.Provider>;
}
export function useSimulation() {
  const provider = useContext(Context); if (!provider) throw new Error('Missing simulation provider');
  const snapshot = useSyncExternalStore(provider.subscribe, provider.getSnapshot, provider.getSnapshot);
  return { provider, ...snapshot };
}
