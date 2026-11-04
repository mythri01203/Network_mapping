import React, { useMemo, useState } from 'react';
import type L from 'leaflet';

import type { EquipmentType } from '@fibergis/shared';

import { cn } from '../../components/ui';
import { EQUIPMENT_DRAG_TYPE } from '../../lib/browser';
import { useBikerStore } from '../../stores/bikerStore';
import { DEFAULT_VIEWPORT, useMapStore } from '../../stores/mapStore';
import { addEquipment } from '../../stores/networkActions';
import { useNetworkStore } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';
import { BikerModePanel } from '../field-work/BikerModePanel';
import { oltFamily, type OltFilter } from './layerFilters';
import { BikerRouteLayer } from './layers/BikerRouteLayer';
import { CableLayer } from './layers/CableLayer';
import { CustomerLayer } from './layers/CustomerLayer';
import { EquipmentLayer } from './layers/EquipmentLayer';
import { FaultLayer } from './layers/FaultLayer';
import { ProjectStartMarker } from './layers/ProjectStartMarker';
import { useVisibleCables, useVisibleEquipment } from './layers/useVisibleNetwork';
import { useLeafletMap } from './leaflet/useLeafletMap';
import { useUserLocation } from './leaflet/useUserLocation';
import { MapControls, OltFilterControl } from './MapControls';
import { MapToolbar } from './MapToolbar';
import { categoryForType } from './markerIcons';
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

  const handleDrop = (e: React.DragEvent) => {
    const type = e.dataTransfer.getData(EQUIPMENT_DRAG_TYPE) as EquipmentType;
    if (!map || !type) return;
    e.preventDefault();
    const { lat, lng } = map.mouseEventToLatLng(e.nativeEvent);
    const created = addEquipment({ name: `New ${type}`, type, lat, lng, category: categoryForType(type) });
    if (created) {
      useUiStore.getState().select({ type: 'equipment', data: created });
      useUiStore.getState().setPanelOpen('right', true);
    }
  };

  return (
    <div
      className={cn(
        'relative h-full w-full select-none overflow-hidden bg-slate-100',
        activeTool !== 'select' && 'gis-map--drawing',
      )}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div ref={containerRef} className="h-full w-full" />

      {map && <MapOverlays map={map} oltFilter={oltFilter} />}

      <MapToolbar
        isBikerMode={isBikerMode}
        onToggleBikerMode={() => useBikerStore.getState().setBikerMode(!isBikerMode)}
      />
      {map && <MapViewControls map={map} />}
      <OltFilterControl value={oltFilter} onChange={setOltFilter} counts={oltCounts} />
      <BikerModePanel />
    </div>
  );
};

function MapOverlays({ map, oltFilter }: { map: L.Map; oltFilter: OltFilter }) {
  const equipment = useVisibleEquipment(oltFilter);
  const cables = useVisibleCables();
  return (
    <>
      <CableLayer map={map} cables={cables} />
      <EquipmentLayer map={map} equipment={equipment} />
      <CustomerLayer map={map} />
      <FaultLayer map={map} />
      <ProjectStartMarker map={map} />
      <BikerRouteLayer map={map} />
      <SketchTools map={map} snapCandidates={equipment} />
    </>
  );
}

function MapViewControls({ map }: { map: L.Map }) {
  const { locate, isLocating } = useUserLocation(map);
  return (
    <MapControls
      onZoomIn={() => map.zoomIn()}
      onZoomOut={() => map.zoomOut()}
      onLocate={locate}
      isLocating={isLocating}
      onResetView={() => map.flyTo([DEFAULT_VIEWPORT.lat, DEFAULT_VIEWPORT.lng], DEFAULT_VIEWPORT.zoom)}
    />
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
