import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBikerStore } from './bikerStore';
import { useMapStore } from './mapStore';
import { useNetworkStore } from './networkStore';
import { useToastStore } from './toastStore';
import { useUiStore } from './uiStore';

const destination = { id: 'DEST', name: 'Customer site', lat: 12.99, lng: 77.62 };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Promise.reject(new Error('offline'))),
  );
  useBikerStore.getState().clearRoute();
  useUiStore.setState({ selectedObject: null });
  useToastStore.setState({ toasts: [] });
});

afterEach(() => vi.unstubAllGlobals());

describe('bikerStore', () => {
  it('routes from the first OLT and falls back to an estimate when offline', async () => {
    const olt = useNetworkStore.getState().equipment.find((e) => e.type === 'OLT')!;
    useBikerStore.getState().navigateTo(destination);
    await flush();

    const { route, waypoints } = useBikerStore.getState();
    expect(waypoints).toEqual([destination]);
    expect(route?.coordinates[0]).toEqual([olt.lat, olt.lng]);
    expect(route?.coordinates.at(-1)).toEqual([destination.lat, destination.lng]);
    expect(route?.limitation).toMatch(/estimated/i);
    expect(useMapStore.getState().flyToTarget).toEqual({ lat: destination.lat, lng: destination.lng, zoom: 16 });
    expect(useToastStore.getState().toasts.at(-1)?.title).toBe('Estimated Route Ready');
  });

  it('starts from the selected asset when it is not the destination', async () => {
    const customer = useNetworkStore.getState().customers[0];
    useUiStore.getState().select({ type: 'customer', data: customer });
    useBikerStore.getState().navigateTo(destination);
    await flush();
    expect(useBikerStore.getState().route?.coordinates[0]).toEqual([customer.lat, customer.lng]);
  });

  it('picks another hub when the selected OLT is itself the destination', async () => {
    const [first, second] = useNetworkStore.getState().equipment.filter((e) => e.type === 'OLT');
    useUiStore.getState().select({ type: 'equipment', data: first });
    useBikerStore.getState().navigateTo({ id: first.id, name: first.name, lat: first.lat, lng: first.lng });
    await flush();
    expect(useBikerStore.getState().route?.coordinates[0]).toEqual([second.lat, second.lng]);
    expect(useToastStore.getState().toasts.map((t) => t.title)).not.toContain('No Route Origin');
  });

  it('collects unique waypoints', async () => {
    const { addWaypoint } = useBikerStore.getState();
    addWaypoint(destination);
    addWaypoint(destination);
    addWaypoint({ ...destination, id: 'NEXT', lat: 13 });
    await flush();
    expect(useBikerStore.getState().waypoints.map((w) => w.id)).toEqual(['DEST', 'NEXT']);
  });

  it('ignores a response that arrives after the route was cleared', async () => {
    let respond: (value: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((resolve) => (respond = resolve))),
    );
    useBikerStore.getState().navigateTo(destination);
    useBikerStore.getState().clearRoute();
    respond(Response.json({ routes: [] }));
    await flush();
    expect(useBikerStore.getState().route).toBeNull();
  });
});
