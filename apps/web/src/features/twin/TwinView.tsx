import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { startTwin, twinCss, type TwinHandle, twinMarkup } from 'virtual:fibergis-twin';
import { useShallow } from 'zustand/react/shallow';

import { useOpenView } from '../../app/views';
import { selectOpticalSettings, useNetworkStore } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';
import { buildTwinData } from './twinData';

/**
 * The 3D digital twin of the mapped network, inside the app. It draws what is on the 2D map:
 * the same records from the network store, shaped by `buildTwinData`, so a change on the map
 * shows here the next time the page is opened or the records change. The scene itself is the
 * code in `digital-twin/` (also built into a standalone file), loaded here through the
 * `virtual:fibergis-twin` module with the app's own three.js.
 *
 * Nothing is saved from this page. Cutting a cable or switching a customer here is a what-if.
 */
export function TwinView() {
  const records = useNetworkStore(
    useShallow((s) => ({
      equipment: s.equipment,
      cables: s.cables,
      customers: s.customers,
      splitters: s.splitters,
      closures: s.closures,
    })),
  );
  const optical = useNetworkStore(selectOpticalSettings);
  const data = useMemo(() => buildTwinData(records, { optical }), [records, optical]);
  const openView = useOpenView();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el || !data) return;
    el.innerHTML = twinMarkup;
    let twin: TwinHandle | null = null;
    try {
      // The scene code was written for three.js r128, where OrbitControls hangs off THREE.
      twin = startTwin({ ...THREE, OrbitControls }, data);
      // What was selected on the 2D map: go to it.
      const sel = useUiStore.getState().selectedObject;
      if (sel && (sel.type === 'customer' || sel.type === 'equipment')) twin.goId(sel.data.id);
    } catch (error) {
      el.textContent = `The 3D twin could not start: ${error instanceof Error ? error.message : String(error)}`;
    }
    return () => {
      twin?.dispose();
      el.innerHTML = '';
    };
  }, [data]);

  if (!data)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-slate-600">
        <p className="text-base font-semibold text-slate-900">Nothing to show in 3D yet</p>
        <p className="max-w-md text-sm">
          The digital twin starts at an OLT. Place an OLT on the 2D map, connect cables, boxes and customers to it, and
          they will appear here.
        </p>
        <button
          type="button"
          onClick={() => openView('map')}
          className="min-h-[44px] rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white"
        >
          Go to the 2D map
        </button>
      </div>
    );

  return (
    <div className="flex-1 overflow-auto">
      <style>{twinCss}</style>
      <div ref={root} className="twin-root" />
    </div>
  );
}
