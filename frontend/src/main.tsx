import React from 'react';
import ReactDOM from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import './quarantine.css';
import { Dashboard } from './app/Dashboard';
import { SimulationContext } from './app/SimulationContext';
import { ApiSimulationProvider } from './providers/ApiSimulationProvider';
import { MockSimulationProvider } from './providers/MockSimulationProvider';
import { parseConfig } from './utils/config';
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <main className="loading-state"><h1>No se pudo mostrar la operación</h1><p>Recarga la vista para volver a conectar.</p><button onClick={() => location.reload()}>Recargar</button></main> : this.props.children; }
}
const config = parseConfig(import.meta.env);
const provider = config.source === 'mock' ? new MockSimulationProvider() : new ApiSimulationProvider(config.base);
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><SimulationContext provider={provider}><Dashboard/></SimulationContext></ErrorBoundary></React.StrictMode>);
