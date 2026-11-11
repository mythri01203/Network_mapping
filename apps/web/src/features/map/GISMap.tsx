import React, { useMemo, useState } from 'react';
import type L from 'leaflet';
import { X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { buildPonOverview, type Equipment, type EquipmentType } from '@fibergis/shared';

import { cn } from '../../components/ui';
import { EQUIPMENT_DRAG_TYPE } from '../../lib/browser';
import { useBikerStore } from '../../stores/bikerStore';
import { DEFAULT_VIEWPORT, useMapStore } from '../../stores/mapStore';
import { useNetworkStore } from '../../stores/networkStore';
import { placeEquipmentChecked } from '../../stores/ospActions';
import { useSelectionStore } from '../../stores/selectionStore';
import { useSyncStore } from '../../stores/syncStore';
import { showToast } from '../../stores/toastStore';
import { selectionLabel, useUiStore } from '../../stores/uiStore';
import { BikerModePanel } from '../field-work/BikerModePanel';
import { SelectionLayer } from '../selection/SelectionLayer';
import { keyForSelection } from '../selection/selectionModel';
import { EquipmentToolbox } from './EquipmentToolbox';
import { oltFamily, type OltFilter } from './layerFilters';
import { BikerRouteLayer } from './layers/BikerRouteLayer';
import { CableLayer } from './layers/CableLayer';
import { CustomerLayer } from './layers/CustomerLayer';
import { EquipmentLayer } from './layers/EquipmentLayer';
import { FaultLayer } from './layers/FaultLayer';
import { OspLayer } from './layers/OspLayer';
import { ProjectStartMarker } from './layers/ProjectStartMarker';
import { useVisibleCables, useVisibleEquipment } from './layers/useVisibleNetwork';
import { ZoneLayer } from './layers/ZoneLayer';
import { useLeafletMap, useMapZoom } from './leaflet/useLeafletMap';
import { useUserLocation } from './leaflet/useUserLocation';
import { MapControls, OltFilterControl } from './MapControls';
import { networkExtent } from './mapExtent';
import { MapStatus } from './MapStatus';
import { MapToolbar } from './MapToolbar';
import { categoryForType } from './markerIcons';
import { PonPanel } from './pon/PonPanel';
import { newEquipmentName, nextPoleName } from './sketch/poleNaming';
import { SketchTools } from './sketch/SketchTools';

/** The map canvas: owns the Leaflet instance and composes the network layers, tools and controls. */
export const GISMap: React.FC = () => {
  const { map, containerRef } = useLeafletMap();
  const activeTool = useMapStore((s) => s.activeTool);
  const isBikerMode = useBikerStore((s) => s.isBikerMode);
  const [oltFilter, setOltFilter] = useState<OltFilter>('All');
  const oltCounts = useOltCounts();

  const handleDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(EQUIPMENT_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = async (e: React.DragEvent) => {
    const rawType = e.dataTransfer.getData(EQUIPMENT_DRAG_TYPE) as EquipmentType;
    const rawPayload = e.dataTransfer.getData('text/plain');
    if (!map || (!rawType && !rawPayload)) return;
    e.preventDefault();
    const { lat, lng } = map.mouseEventToLatLng(e.nativeEvent);

    let name = '';
    let type = rawType;
    let totalPorts: number | undefined;
    // Phase 2: a product model dropped on the map links to it and takes its make and model.
    const fromModel: Partial<Equipment> = {};

    try {
      if (rawPayload && rawPayload.startsWith('{')) {
        const parsed = JSON.parse(rawPayload);
        if (parsed.type) type = parsed.type;
        if (parsed.name) name = parsed.name;
        if (typeof parsed.totalPorts === 'number') totalPorts = parsed.totalPorts;
        for (const key of ['catalogModelId', 'manufacturer', 'model'] as const) if (typeof parsed[key] === 'string') fromModel[key] = parsed[key];
      }
    } catch {
      // ignore
    }

    const placedType = type || 'Outdoor Splitter';
    const created = await placeEquipmentChecked({
      // Poles take the next free number, never the catalog name.
      name: placedType.includes('Pole') ? nextPoleName(useNetworkStore.getState().equipment) : name || newEquipmentName(placedType, useNetworkStore.getState().equipment),
      type: placedType,
      locationMethod: 'map_pick',
      lat,
      lng,
      category: categoryForType(type || 'Outdoor Splitter'),
      totalPorts,
      availablePorts: totalPorts,
      ...fromModel,
    });
    if (created) {
      useUiStore.getState().select({ type: 'equipment', data: created });
      useUiStore.getState().setPanelOpen('right', true);
      if (created.type === 'OLT') {
        useUiStore.getState().openOltConfigModal(created);
      }
    }
  };

  return (
    <div
      className={cn(
        'gis-print-area relative h-full w-full select-none overflow-hidden bg-slate-100',
        activeTool !== 'select' && 'gis-map--drawing',
      )}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div ref={containerRef} className="h-full w-full" />

      {map && <MapOverlays map={map} oltFilter={oltFilter} />}
      {map && <MapStatus map={map} />}
      <PrintCaption />

      <div className="gis-no-print">
        <EquipmentToolbox />
        <MapToolbar
          isBikerMode={isBikerMode}
          onToggleBikerMode={() => useBikerStore.getState().setBikerMode(!isBikerMode)}
        />
      </div>
      {map && <MapViewControls map={map} />}
      {map && <InitialFit map={map} />}
      <PonPanel />
      <div className="gis-no-print">
        <OltFilterControl value={oltFilter} onChange={setOltFilter} counts={oltCounts} />
        <BikerModePanel />
        <PhoneSelectionBar />
      </div>
    </div>
  );
};

/** Phones only: names what is selected and opens its details, without covering the map. */
function PhoneSelectionBar() {
  const { selection, panelOpen, select, setPanelOpen } = useUiStore(
    useShallow((s) => ({ selection: s.selectedObject, panelOpen: s.panels.right, select: s.select, setPanelOpen: s.setPanelOpen })),
  );
  const tool = useMapStore((s) => s.activeTool);
  const moving = useMapStore((s) => s.movingEquipmentId);
  // Out of the way while drawing, measuring, placing or moving.
  if (!selection || panelOpen || tool !== 'select' || moving) return null;
  return (
    <div className="absolute bottom-[64px] left-2 right-[64px] z-[445] flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-1.5 pl-3 shadow-lg md:hidden">
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-900">{selectionLabel(selection)}</span>
      <button
        type="button"
        onClick={() => setPanelOpen('right', true)}
        className="h-[48px] shrink-0 rounded-lg bg-blue-600 px-4 text-[13px] font-semibold text-white"
      >
        Details
      </button>
      {/* Phase 16: the right-click menu, for a phone (open, zoom, trace, select connected, copy id). */}
      <button
        type="button"
        onClick={() => useSelectionStore.getState().openMenu({ key: keyForSelection(selection), x: 0, y: 0, sheet: true })}
        className="h-[48px] shrink-0 rounded-lg bg-slate-100 px-3 text-[13px] font-semibold text-slate-800"
        data-testid="phone-selection-more"
      >
        More
      </button>
      <button
        type="button"
        aria-label="Clear selection"
        onClick={() => select(null)}
        className="flex h-[48px] w-[48px] shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
      >
        <X size={20} />
      </button>
    </div>
  );
}

function MapOverlays({ map, oltFilter }: { map: L.Map; oltFilter: OltFilter }) {
  const zoom = useMapZoom(map);
  const equipment = useVisibleEquipment(oltFilter, zoom);
  const cables = useVisibleCables(zoom);
  return (
    <>
      <ZoneLayer map={map} />
      <OspLayer map={map} />
      <CableLayer map={map} cables={cables} />
      <EquipmentLayer map={map} equipment={equipment} />
      <CustomerLayer map={map} />
      <FaultLayer map={map} />
      <ProjectStartMarker map={map} />
      <BikerRouteLayer map={map} />
      <SketchTools map={map} snapCandidates={equipment} />
      {/* Phase 16: the selection set, box/lasso/area tools and the right-click menu. */}
      <SelectionLayer map={map} />
    </>
  );
}

/**
 * The map position is not kept between visits, so a fresh page would open on the default spot even
 * when the network is elsewhere. On first load it flies to the network instead.
 */
function InitialFit({ map }: { map: L.Map }) {
  const hasData = useNetworkStore((s) => s.equipment.length + s.cables.length + s.customers.length > 0);
  // Wait for the server's network: before it arrives a new browser shows the bundled sample.
  const phase = useSyncStore((s) => s.phase);
  const settled = phase !== 'connecting';
  const ready = hasData && settled;
  const done = React.useRef(false);
  React.useEffect(() => {
    if (done.current || !ready) return;
    done.current = true;
    const { viewport } = useMapStore.getState();
    // A resize right after start nudges the centre a little, so "not moved yet" allows a small difference.
    const untouched = Math.abs(viewport.lat - DEFAULT_VIEWPORT.lat) < 0.02 && Math.abs(viewport.lng - DEFAULT_VIEWPORT.lng) < 0.02;
    // Where the PONs serve customers, if any are traced: that is the network people came to see.
    const pons = untouched ? buildPonOverview(useNetworkStore.getState()).pons.filter((p) => p.bounds) : [];
    const ponExtent = pons.length
      ? {
          south: Math.min(...pons.map((p) => p.bounds!.south)),
          west: Math.min(...pons.map((p) => p.bounds!.west)),
          north: Math.max(...pons.map((p) => p.bounds!.north)),
          east: Math.max(...pons.map((p) => p.bounds!.east)),
        }
      : null;
    const extent = untouched ? (ponExtent ?? networkExtent(useNetworkStore.getState())) : null;
    if (!extent) return;
    const center: [number, number] = [(extent.south + extent.north) / 2, (extent.west + extent.east) / 2];
    // Start wide, then glide in: the whole network first, so people see where everything is.
    map.setView(center, 11, { animate: false });
    window.setTimeout(() => useMapStore.getState().fitBounds(extent), 250);
  }, [map, ready]);
  return null;
}

/** Prints the map alone: the page around it is hidden by the print styles while this runs. */
function printMap(map: L.Map) {
  document.body.classList.add('gis-printing');
  map.invalidateSize({ pan: false });
  const done = () => {
    document.body.classList.remove('gis-printing');
    map.invalidateSize({ pan: false });
  };
  window.addEventListener('afterprint', done, { once: true });
  // Give the tiles a moment to load at the print size.
  window.setTimeout(() => window.print(), 700);
}

function MapViewControls({ map }: { map: L.Map }) {
  const { locate, isLocating } = useUserLocation(map);
  const fitNetwork = () => {
    const extent = networkExtent(useNetworkStore.getState());
    if (!extent) {
      showToast('info', 'Nothing placed yet', 'There is nothing with a place on the map yet. Add equipment or draw a cable first.');
      return;
    }
    useMapStore.getState().fitBounds(extent);
  };
  return (
    <MapControls
      onZoomIn={() => map.zoomIn()}
      onZoomOut={() => map.zoomOut()}
      onLocate={locate}
      isLocating={isLocating}
      onFitNetwork={fitNetwork}
      onPrint={() => printMap(map)}
    />
  );
}

/** Only on paper: when and from where it was printed, and that it is not a survey. */
function PrintCaption() {
  const [now] = useState(() => new Date());
  return (
    <div className="gis-print-only absolute inset-x-0 top-0 z-[1000] bg-white px-3 py-1.5 text-[12px] text-slate-800">
      FiberGIS map, printed {now.toLocaleString()}. Positions are as recorded in FiberGIS. Not a survey drawing.
    </div>
  );
}

function useOltCounts(): Record<OltFilter, number> {
  const equipment = useNetworkStore((s) => s.equipment);
  return useMemo(() => {
    const counts: Record<OltFilter, number> = { All: 0, GPON: 0, EPON: 0 };
    for (const eq of equipment) {
      if (eq.type !== 'OLT') continue;
      counts.All += 1;
      counts[oltFamily(eq)] += 1;
    }
    return counts;
  }, [equipment]);
}
