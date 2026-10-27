import { describe, it, expect, vi } from 'vitest';
import { act, render, fireEvent } from '@testing-library/react';
import { Browser, Map as LeafletMap, TileLayer as LeafletTileLayer } from 'leaflet';
import { MapBoard, initialLayers, selectionPosition } from './MapBoard';
import { adaptState, prepareMap } from '../services/adapter';
import { frameFixtures, mapFixture } from '../test/fixtures';

describe('Leaflet component smoke (jsdom, not visual QA)', () => {
  it('removes a failed external tile layer while preserving real streets and entities', () => {
    const oldCanvas = Browser.canvas, oldSvg = Browser.svg;
    Reflect.set(Browser, 'canvas', false); Reflect.set(Browser, 'svg', true);
    const added = vi.spyOn(LeafletMap.prototype, 'addLayer');
    const removed = vi.spyOn(LeafletMap.prototype, 'removeLayer');
    try {
      const state = adaptState(frameFixtures[0], prepareMap(mapFixture));
      const view = render(<MapBoard state={state} selected={null} onSelect={vi.fn()} layers={initialLayers}/>);
      const tileLayer = added.mock.calls.map(([layer]) => layer).find(layer => layer instanceof LeafletTileLayer);
      expect(tileLayer).toBeDefined();
      act(() => { tileLayer!.fire('tileerror'); });
      expect(view.getByText('Fondo no disponible · red vial local')).toBeInTheDocument();
      expect(removed).toHaveBeenCalledWith(tileLayer);
      expect(view.container.querySelectorAll('svg path').length).toBeGreaterThan(100);
      expect(view.container.querySelectorAll('.truck-pin')).toHaveLength(5);
      expect(view.container.querySelectorAll('.shelter-pin')).toHaveLength(4);
      view.unmount();
    } finally {
      added.mockRestore(); removed.mockRestore();
      Reflect.set(Browser, 'canvas', oldCanvas); Reflect.set(Browser, 'svg', oldSvg);
    }
  });
  it('mounts the real Leaflet layers, keeps the map through updates and selects a truck', () => {
    const oldCanvas = Browser.canvas, oldSvg = Browser.svg;
    Reflect.set(Browser, 'canvas', false); Reflect.set(Browser, 'svg', true);
    try {
      const map = prepareMap(mapFixture), select = vi.fn();
      const props = { selected: null, onSelect: select, layers: initialLayers };
      const view = render(<MapBoard {...props} state={adaptState(frameFixtures[0], map)}><div data-testid="overlay-probe">Detalle dentro del mapa</div></MapBoard>);
      const container = view.container.querySelector('.leaflet-container');
      expect(container).toBeTruthy();
      const overlay = view.getByTestId('overlay-probe');
      expect(view.getByTestId('map-shell')).toContainElement(overlay);
      expect(container).not.toContainElement(overlay);
      expect(view.container.querySelectorAll('.truck-pin')).toHaveLength(5);
      expect(view.container.querySelectorAll('.shelter-pin')).toHaveLength(4);
      expect(view.container.querySelectorAll('svg path').length).toBeGreaterThan(100);
      fireEvent.click(view.container.querySelector('.truck-pin')!);
      expect(select).toHaveBeenCalledWith({ kind: 'truck', id: 'V-001' });
      view.rerender(<MapBoard {...props} state={adaptState(frameFixtures.at(-1)!, map)}/>);
      expect(view.container.querySelector('.leaflet-container')).toBe(container);
      expect(view.container.querySelectorAll('.truck-pin')).toHaveLength(5);
      view.unmount();
    } finally { Reflect.set(Browser, 'canvas', oldCanvas); Reflect.set(Browser, 'svg', oldSvg); }
  });
  it('zooms gently once per selection and never takes the camera back on polling', () => {
    const oldCanvas = Browser.canvas, oldSvg = Browser.svg;
    Reflect.set(Browser, 'canvas', false); Reflect.set(Browser, 'svg', true);
    const fly = vi.spyOn(LeafletMap.prototype, 'flyTo').mockReturnThis();
    try {
      const map = prepareMap(mapFixture), state = adaptState(frameFixtures[0], map);
      const props = { onSelect: vi.fn(), layers: initialLayers };
      const view = render(<MapBoard {...props} selected={null} state={state}/>);
      const before = (view.container.querySelector('.leaflet-container') as HTMLElement);
      expect(fly).not.toHaveBeenCalled();
      const selection = { kind: 'truck' as const, id: 'V-001' };
      view.rerender(<MapBoard {...props} selected={selection} state={state}/>);
      expect(fly).toHaveBeenCalledTimes(1);
      expect(fly.mock.calls[0][0]).toEqual(state.trucks[0].position);
      expect(fly.mock.calls[0][2]).toMatchObject({ duration: 0.65 });
      view.rerender(<MapBoard {...props} selected={selection} state={adaptState(frameFixtures.at(-1)!, map)}/>);
      expect(fly).toHaveBeenCalledTimes(1);
      expect(view.container.querySelector('.leaflet-container')).toBe(before);
      view.rerender(<MapBoard {...props} selected={{ kind: 'truck', id: 'V-002' }} state={state}/>);
      expect(fly).toHaveBeenCalledTimes(2);
      view.unmount();
    } finally { fly.mockRestore(); Reflect.set(Browser, 'canvas', oldCanvas); Reflect.set(Browser, 'svg', oldSvg); }
  });
  it('locates a passenger at their truck, without inventing missing coordinates', () => {
    const state = adaptState(frameFixtures[0], prepareMap(mapFixture));
    const person = state.survivors[0];
    person.state = 'EN_CAMIONETA'; person.truck = state.trucks[0].id;
    state.trucks[0].position = [-0.96, -80.71];
    expect(selectionPosition(state, { kind: 'survivor', id: person.id })).toEqual([-0.96, -80.71]);
    expect(selectionPosition(state, { kind: 'zombie', id: 'unknown' })).toBeUndefined();
  });

  it('keeps eliminated people above zombies and toggles them independently', () => {
    const oldCanvas = Browser.canvas, oldSvg = Browser.svg;
    Reflect.set(Browser, 'canvas', false); Reflect.set(Browser, 'svg', true);
    try {
      const state = adaptState(frameFixtures[0], prepareMap(mapFixture));
      state.survivors[0].state = 'ELIMINADO';
      const props = { state, selected: null, onSelect: vi.fn() };
      const view = render(<MapBoard {...props} layers={{ ...initialLayers, survivors: false }}/>);
      const icon = view.container.querySelector('.person-pin.eliminated');
      expect(icon).toBeTruthy();
      const index = Number((icon!.parentElement as HTMLElement).style.zIndex);
      expect(index).toBeGreaterThan(800);
      expect(view.container.querySelector('.person-pin:not(.eliminated)')).toBeNull();
      view.rerender(<MapBoard {...props} layers={{ ...initialLayers, survivors: false, eliminated: false }}/>);
      expect(view.container.querySelector('.person-pin.eliminated')).toBeNull();
      view.unmount();
    } finally { Reflect.set(Browser, 'canvas', oldCanvas); Reflect.set(Browser, 'svg', oldSvg); }
  });

  it('renders a repair badge from backend turns and removes it after recovery', () => {
    const oldCanvas = Browser.canvas, oldSvg = Browser.svg;
    Reflect.set(Browser, 'canvas', false); Reflect.set(Browser, 'svg', true);
    try {
      const state = adaptState(frameFixtures[0], prepareMap(mapFixture));
      state.trucks[0] = { ...state.trucks[0], state: 'AVERIADA', repairTurns: 4, breakdownCause: 'horda', breakdowns: 1 };
      const props = { selected: null, onSelect: vi.fn(), layers: initialLayers };
      const view = render(<MapBoard {...props} state={state}/>);
      expect(view.container.querySelector('.truck-broken em')).toHaveTextContent('4t');
      view.rerender(<MapBoard {...props} state={{ ...state, trucks: state.trucks.map(v => ({ ...v, repairTurns: 0, state: 'DISPONIBLE' })) }}/>);
      expect(view.container.querySelector('.truck-broken')).toBeNull();
      view.unmount();
    } finally { Reflect.set(Browser, 'canvas', oldCanvas); Reflect.set(Browser, 'svg', oldSvg); }
  });

});
