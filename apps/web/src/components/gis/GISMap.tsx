import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import { addEquipment, deleteCable, updateEquipment } from '../../stores/networkActions';
import { useShallow } from 'zustand/react/shallow';
import { useBikerStore } from '../../stores/bikerStore';
import { useToastStore } from '../../stores/toastStore';
import { useTraceStore } from '../../stores/traceStore';
import { useUiStore } from '../../stores/uiStore';
import { useNetworkStore } from '../../stores/networkStore';
import { DEFAULT_VIEWPORT, useMapStore } from '../../stores/mapStore';
import type { Equipment, EquipmentType } from '@fibergis/shared';
import { cableStyle } from '../../theme/network';
import { BikerModePanel } from '../biker/BikerModePanel';
import { Activity, Zap, X, Grid, Cpu } from 'lucide-react';
import { getOltChassisSvgString, OltChassisIcon } from '../common/OltChassisIcon';
import { getUtilityPoleSvgString } from '../common/UtilityPoleIcon';
import { MapToolbar, MapModeBar } from './map/MapToolbar';
import { MapControls, OltFilterControl } from './map/MapControls';
import { categoryForType } from './map/markerIcons';

// Generate custom SVG icon for each equipment type
const createCustomMarkerIcon = (
  type: EquipmentType,
  status: string,
  isSelected: boolean,
  isTraced: boolean,
  technology?: string,
) => {
  // Use Realistic 19" Rack-Mount Chassis Shape for OLT
  if (type === 'OLT') {
    const width = isSelected ? 58 : isTraced ? 54 : 48;
    const height = isSelected ? 30 : isTraced ? 28 : 25;
    const oltHtml = getOltChassisSvgString(status, isSelected, isTraced, width, height, technology);
    return L.divIcon({
      html: oltHtml,
      className: `gis-equipment-marker olt-chassis-marker ${isSelected ? 'selected' : ''} ${status === 'Faulty' ? 'faulty' : ''}`,
      iconSize: [width, height],
      iconAnchor: [width / 2, height / 2],
      popupAnchor: [0, -height / 2],
    });
  }

  // Use Realistic Wooden T-Crossarm Utility Pole Shape
  if (type.includes('Pole')) {
    const width = isSelected ? 36 : isTraced ? 34 : 30;
    const height = isSelected ? 46 : isTraced ? 42 : 38;
    const poleHtml = getUtilityPoleSvgString(status, isSelected, isTraced, width, height);
    return L.divIcon({
      html: poleHtml,
      className: `gis-equipment-marker utility-pole-marker ${isSelected ? 'selected' : ''} ${status === 'Faulty' ? 'faulty' : ''}`,
      iconSize: [width, height],
      iconAnchor: [width / 2, height * 0.28], // Anchor at crossarm level so overhead wires snap directly to insulators
      popupAnchor: [0, -height * 0.28],
    });
  }

  let color = '#0284c7';
  let badgeColor = '#10b981';
  let letter = 'EQ';

  if (type === 'ODF') {
    color = '#4338ca'; // Indigo
    letter = 'ODF';
  } else if (type === 'FDMS') {
    color = '#0e7490'; // Cyan/Teal
    letter = 'FDM';
  } else if (type === 'FDT') {
    color = '#0284c7'; // Sky
    letter = 'FDT';
  } else if (type === 'FAT' || type.includes('Terminal Box')) {
    color = '#059669'; // Emerald
    letter = 'FAT';
  } else if (type.includes('Joint Closure') || type.includes('Splice')) {
    color = '#d97706'; // Amber
    letter = 'JC';
  } else if (type.includes('Splitter')) {
    color = '#7c3aed'; // Violet
    letter = 'SP';
  } else if (type.includes('Pole')) {
    color = '#475569'; // Slate
    letter = 'P';
  } else if (type.includes('Manhole') || type.includes('Chamber')) {
    color = '#334155'; // Dark Slate
    letter = 'MH';
  } else if (type.includes('CATV') || type.includes('Amplifier')) {
    color = '#ea580c'; // Orange
    letter = 'RF';
  }

  if (status === 'Faulty') badgeColor = '#ef4444';
  else if (status === 'Warning') badgeColor = '#f59e0b';
  else if (status === 'Maintenance') badgeColor = '#8b5cf6';

  const ringStyle = isSelected
    ? `stroke="#2563eb" stroke-width="4" stroke-dasharray="3,3"`
    : isTraced
      ? `stroke="#10b981" stroke-width="4"`
      : `stroke="#ffffff" stroke-width="2.5"`;

  const size = isSelected ? 38 : isTraced ? 36 : type.includes('Pole') || type.includes('Manhole') ? 26 : 32;

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 40 40">
      <defs>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#0f172a" flood-opacity="0.3"/>
        </filter>
      </defs>
      <circle cx="20" cy="20" r="16" fill="${color}" ${ringStyle} filter="url(#shadow)" />
      <text x="20" y="24" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="${letter.length > 2 ? '10' : '12'}" font-weight="bold" fill="#ffffff" text-anchor="middle">${letter}</text>
      <circle cx="30" cy="10" r="5" fill="${badgeColor}" stroke="#ffffff" stroke-width="1.5" />
    </svg>
  `;

  return L.divIcon({
    html: svg,
    className: `gis-equipment-marker ${isSelected ? 'selected' : ''} ${status === 'Faulty' ? 'faulty' : ''}`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
};

const createCustomerMarkerIcon = (status: string, isSelected: boolean) => {
  const color = status === 'Active' ? '#2563eb' : status === 'Suspended' ? '#f59e0b' : '#ef4444';
  const size = isSelected ? 28 : 22;

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" fill="${color}" stroke="#ffffff" stroke-width="2" />
      <path d="M12 6 L17 11 L15 11 L15 17 L9 17 L9 11 L7 11 Z" fill="#ffffff"/>
    </svg>
  `;

  return L.divIcon({
    html: svg,
    className: 'gis-customer-marker',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
};

export const GISMap: React.FC = () => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);

  // Layer groups for clean management
  const equipmentLayerGroupRef = useRef<L.LayerGroup>(L.layerGroup());
  const cableLayerGroupRef = useRef<L.LayerGroup>(L.layerGroup());
  const customerLayerGroupRef = useRef<L.LayerGroup>(L.layerGroup());
  const faultLayerGroupRef = useRef<L.LayerGroup>(L.layerGroup());
  const drawLayerGroupRef = useRef<L.LayerGroup>(L.layerGroup());
  const traceLayerGroupRef = useRef<L.LayerGroup>(L.layerGroup());
  const bikerLayerGroupRef = useRef<L.LayerGroup>(L.layerGroup());
  const userLocationLayerRef = useRef<L.LayerGroup>(L.layerGroup());
  const projectStartLayerGroupRef = useRef<L.LayerGroup>(L.layerGroup());
  const markerMapRef = useRef<Map<string, L.Marker>>(new Map());

  const { equipments, cables, customers, faults, projectStartPoint } = useNetworkStore(
    useShallow((s) => ({
      equipments: s.equipment,
      cables: s.cables,
      customers: s.customers,
      faults: s.faults,
      projectStartPoint: s.projectStartPoint,
    })),
  );
  const {
    selectedObject,
    setSelectedObject,
    networkMode,
    setModalOpen,
    isLeftPanelOpen,
    isRightPanelOpen,
    setPanelOpen,
    isBottomPanelOpen,
    isSidebarCollapsed,
  } = useUiStore(
    useShallow((s) => ({
      selectedObject: s.selectedObject,
      setSelectedObject: s.select,
      networkMode: s.networkMode,
      setModalOpen: s.setModalOpen,
      isLeftPanelOpen: s.panels.left,
      isRightPanelOpen: s.panels.right,
      setPanelOpen: s.setPanelOpen,
      isBottomPanelOpen: s.panels.bottom,
      isSidebarCollapsed: s.isSidebarCollapsed,
    })),
  );
  const {
    activeTool,
    setActiveTool,
    selectedEquipmentTypeToAdd,
    setSelectedEquipmentTypeToAdd,
    setSelectedCableTypeToDraw,
    activeDrawingPoints,
    setActiveDrawingPoints,
    measuringPoints,
    setMeasuringPoints,
    activeLayers,
    mapTileProvider,
    mapFlyToTarget,
  } = useMapStore(
    useShallow((s) => ({
      activeTool: s.activeTool,
      setActiveTool: s.setActiveTool,
      selectedEquipmentTypeToAdd: s.equipmentTypeToAdd,
      setSelectedEquipmentTypeToAdd: s.setEquipmentTypeToAdd,
      setSelectedCableTypeToDraw: s.setCableTypeToDraw,
      activeDrawingPoints: s.drawingPoints,
      setActiveDrawingPoints: s.setDrawingPoints,
      measuringPoints: s.measuringPoints,
      setMeasuringPoints: s.setMeasuringPoints,
      activeLayers: s.layers,
      mapTileProvider: s.tileProvider,
      mapFlyToTarget: s.flyToTarget,
    })),
  );
  const { activeTraceCableIds, activeTraceEquipmentIds } = useTraceStore(
    useShallow((s) => ({ activeTraceCableIds: s.cableIds, activeTraceEquipmentIds: s.equipmentIds })),
  );
  const showToast = useToastStore((s) => s.show);
  const { isBikerMode, setIsBikerMode, bikerRoute, bikerWaypoints } = useBikerStore(
    useShallow((s) => ({
      isBikerMode: s.isBikerMode,
      setIsBikerMode: s.setBikerMode,
      bikerRoute: s.route,
      bikerWaypoints: s.waypoints,
    })),
  );

  const [snapTarget, setSnapTarget] = useState<{ lat: number; lng: number; id: string; name: string } | null>(null);
  const [tempMousePos, setTempMousePos] = useState<[number, number] | null>(null);
  const [cumulativeDistance, setCumulativeDistance] = useState<number>(0);
  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [autoAddPolesOnDraw, setAutoAddPolesOnDraw] = useState<boolean>(false);
  const [activeOltModal, setActiveOltModal] = useState<Equipment | null>(null);
  const [oltTechFilter, setOltTechFilter] = useState<'All' | 'GPON' | 'EPON'>('All');

  // Synchronize Project Start Point Marker
  useEffect(() => {
    projectStartLayerGroupRef.current.clearLayers();
    if (projectStartPoint) {
      const starIcon = L.divIcon({
        className: 'project-start-marker',
        html: `
          <div style="background:#f59e0b; color:white; border:2.5px solid white; border-radius:50%; width:34px; height:34px; display:flex; align-items:center; justify-content:center; box-shadow:0 3px 12px rgba(0,0,0,0.45); font-size:16px;">
            ⭐
          </div>
        `,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      });
      const marker = L.marker(projectStartPoint, { icon: starIcon });
      marker.bindPopup(`
        <div style="font-family: system-ui, sans-serif; font-size: 13px; line-height: 1.5; padding: 4px;">
          <div style="font-weight: 800; color: #b45309; font-size: 14px;">⭐ FTTH Project Starting Point</div>
          <div><strong>Lat:</strong> ${projectStartPoint[0].toFixed(6)}</div>
          <div><strong>Lng:</strong> ${projectStartPoint[1].toFixed(6)}</div>
          <div style="color: #64748b; font-size: 11px; margin-top: 4px;">Main network anchor. All trunk feeder cables originate from here.</div>
        </div>
      `);
      projectStartLayerGroupRef.current.addLayer(marker);
    }
  }, [projectStartPoint]);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const { viewport } = useMapStore.getState();
    const map = L.map(mapContainerRef.current, {
      center: [viewport.lat, viewport.lng],
      zoom: viewport.zoom,
      zoomControl: false,
      attributionControl: false,
    });

    // Add initial tile layer using Google Maps (Direct Free Tiles, No API Key Required)
    const initialTile = L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
      maxZoom: 21,
      subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
      attribution: '&copy; Google Maps',
    });
    initialTile.addTo(map);
    tileLayerRef.current = initialTile;

    // Add layer groups to map
    cableLayerGroupRef.current.addTo(map);
    equipmentLayerGroupRef.current.addTo(map);
    customerLayerGroupRef.current.addTo(map);
    faultLayerGroupRef.current.addTo(map);
    drawLayerGroupRef.current.addTo(map);
    traceLayerGroupRef.current.addTo(map);
    bikerLayerGroupRef.current.addTo(map);
    userLocationLayerRef.current.addTo(map);
    projectStartLayerGroupRef.current.addTo(map);

    map.on('moveend', () => {
      const center = map.getCenter();
      useMapStore.getState().setViewport({ lat: center.lat, lng: center.lng, zoom: map.getZoom() });
    });

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update base map tile provider (Google Maps Street, Google Satellite, OpenStreetMap)
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    if (tileLayerRef.current) {
      mapInstanceRef.current.removeLayer(tileLayerRef.current);
    }

    let newLayer: L.TileLayer;
    if (mapTileProvider === 'google_satellite') {
      // Google Hybrid (High resolution satellite imagery with clear road labels)
      newLayer = L.tileLayer('https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        maxZoom: 21,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        attribution: '&copy; Google Maps Satellite',
      });
    } else if (mapTileProvider === 'osm') {
      newLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      });
    } else {
      // Default: Google Streets
      newLayer = L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
        maxZoom: 21,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        attribution: '&copy; Google Maps',
      });
    }

    newLayer.addTo(mapInstanceRef.current);
    tileLayerRef.current = newLayer;
  }, [mapTileProvider]);

  // Handle panel resizing
  useEffect(() => {
    const timer = setTimeout(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [isLeftPanelOpen, isRightPanelOpen, isBottomPanelOpen, isSidebarCollapsed]);

  // Handle fly-to targets
  useEffect(() => {
    if (mapFlyToTarget && mapInstanceRef.current) {
      mapInstanceRef.current.flyTo([mapFlyToTarget.lat, mapFlyToTarget.lng], mapFlyToTarget.zoom || 17, {
        duration: 1.2,
      });
      useMapStore.getState().clearFlyTo();
    }
  }, [mapFlyToTarget]);

  // Render Equipment Markers
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const group = equipmentLayerGroupRef.current;
    group.clearLayers();
    markerMapRef.current.clear();

    equipments.forEach((eq) => {
      // Filter by network mode
      if (networkMode === 'Fiber' && eq.category === 'Cable TV Infrastructure') return;
      if (networkMode === 'CableTV' && eq.category === 'Central Office' && eq.type !== 'OLT') return;

      // Filter by layer toggle
      if (eq.type === 'OLT') {
        if (!activeLayers.olt) return;
        const tech = eq.technology || 'GPON';
        if (oltTechFilter !== 'All' && tech !== oltTechFilter) return;
      }
      if (eq.type === 'ODF' && !activeLayers.odf) return;
      if (eq.type === 'FDMS' && !activeLayers.fdms) return;
      if (eq.type === 'FDT' && !activeLayers.fdt) return;
      if ((eq.type === 'FAT' || eq.type.includes('Terminal Box')) && !activeLayers.fat) return;
      if (eq.type.includes('Pole') && !activeLayers.poles) return;
      if ((eq.type.includes('Manhole') || eq.type.includes('Chamber')) && !activeLayers.manholes) return;
      if (eq.category === 'Cable TV Infrastructure' && !activeLayers.cableTv) return;

      const isSelected = selectedObject?.type === 'equipment' && selectedObject.data.id === eq.id;
      const isTraced = activeTraceEquipmentIds.includes(eq.id);

      const marker = L.marker([eq.lat, eq.lng], {
        icon: createCustomMarkerIcon(eq.type, eq.status, isSelected, isTraced, eq.technology),
      });
      markerMapRef.current.set(eq.id, marker);

      // Tooltip with clean details
      marker.bindTooltip(
        `
        <div class="text-xs">
          <div class="font-bold text-sky-400">${eq.id}</div>
          <div class="font-medium">${eq.name}</div>
          <div class="text-[10px] text-slate-300">${eq.type}${eq.type === 'OLT' ? ` (${eq.technology || 'GPON'})` : ''} &bull; ${eq.status}</div>
        </div>
      `,
        {
          direction: 'top',
          className: 'gis-tooltip',
          offset: [0, -16],
        },
      );

      // Interactive Action Popup when clicking OLT
      if (eq.type === 'OLT') {
        const popupHtml = `
          <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; min-width: 255px; padding: 4px;">
            <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 8px;">
              <div>
                <div style="font-size: 10px; font-weight: 800; color: #2563eb; text-transform: uppercase; letter-spacing: 0.5px;">CENTRAL INTERNET HUB</div>
                <div style="font-size: 13px; font-weight: 700; color: #0f172a;">${eq.name || eq.id}</div>
              </div>
              <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 2px;">
                <span style="font-size: 10px; font-weight: 800; background: ${(eq.technology || 'GPON') === 'EPON' ? '#f3e8ff' : '#eff6ff'}; color: ${(eq.technology || 'GPON') === 'EPON' ? '#7e22ce' : '#1d4ed8'}; padding: 2px 7px; border-radius: 9999px; border: 1px solid ${(eq.technology || 'GPON') === 'EPON' ? '#d8b4fe' : '#bfdbfe'};">
                  ${eq.technology || 'GPON'} OLT
                </span>
                <span style="font-size: 9px; font-weight: 600; color: #059669;">16 PON Active</span>
              </div>
            </div>

            <div style="font-size: 11px; font-weight: 700; color: #475569; margin-bottom: 6px;">
              ⚡ Quick Connect & Add Components:
            </div>

            <div style="display: flex; flex-direction: column; gap: 6px;">
              <button id="olt-pop-draw-${eq.id}" style="width: 100%; display: flex; align-items: center; gap: 8px; background: #2563eb; color: #ffffff; border: none; border-radius: 8px; padding: 7px 10px; font-size: 12px; font-weight: 700; cursor: pointer; text-align: left; box-shadow: 0 1px 2px rgba(0,0,0,0.15);">
                <span style="font-size: 14px;">⚡</span>
                <div>
                  <div>Draw Wire from OLT</div>
                  <div style="font-size: 10px; opacity: 0.85; font-weight: 400;">Connect feeder wire to street</div>
                </div>
              </button>

              <button id="olt-pop-pole-${eq.id}" style="width: 100%; display: flex; align-items: center; gap: 8px; background: #f8fafc; color: #1e293b; border: 1px solid #cbd5e1; border-radius: 8px; padding: 6px 10px; font-size: 12px; font-weight: 600; cursor: pointer; text-align: left;">
                <span style="font-size: 14px;">⚡</span>
                <div>
                  <div>+ Place Utility Pole</div>
                  <div style="font-size: 10px; color: #64748b; font-weight: 400;">Mount overhead wires on street pole</div>
                </div>
              </button>

              <button id="olt-pop-fat-${eq.id}" style="width: 100%; display: flex; align-items: center; gap: 8px; background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; border-radius: 8px; padding: 6px 10px; font-size: 12px; font-weight: 600; cursor: pointer; text-align: left;">
                <span style="font-size: 14px;">📦</span>
                <div>
                  <div>+ Add Street Box (FAT)</div>
                  <div style="font-size: 10px; color: #15803d; font-weight: 400;">Branch box for customer home drops</div>
                </div>
              </button>

              <button id="olt-pop-ports-${eq.id}" style="width: 100%; display: flex; align-items: center; gap: 8px; background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; border-radius: 8px; padding: 6px 10px; font-size: 12px; font-weight: 600; cursor: pointer; text-align: left;">
                <span style="font-size: 14px;">🔌</span>
                <div>
                  <div>Inspect 16 PON Ports & Power</div>
                  <div style="font-size: 10px; color: #3b82f6; font-weight: 400;">Check sockets & optical dBm levels</div>
                </div>
              </button>
            </div>
          </div>
        `;

        marker.bindPopup(popupHtml, {
          maxWidth: 290,
          minWidth: 260,
          className: 'olt-quick-popup',
          offset: [0, -14],
        });

        marker.on('popupopen', () => {
          setTimeout(() => {
            const drawBtn = document.getElementById(`olt-pop-draw-${eq.id}`);
            if (drawBtn) {
              drawBtn.onclick = (e) => {
                e.stopPropagation();
                marker.closePopup();
                setSelectedCableTypeToDraw('Main Feeder Fiber');
                setActiveDrawingPoints([[eq.lat, eq.lng]]);
                setActiveTool('draw_cable');
                showToast(
                  'info',
                  'Drawing Feeder Wire',
                  `Started wire from ${eq.name}. Click along the street or poles!`,
                );
              };
            }

            const poleBtn = document.getElementById(`olt-pop-pole-${eq.id}`);
            if (poleBtn) {
              poleBtn.onclick = (e) => {
                e.stopPropagation();
                marker.closePopup();
                setSelectedEquipmentTypeToAdd('Telecom Pole');
                setActiveTool('add_equipment');
                showToast('info', 'Place Utility Pole', 'Click on the map near the road to place a utility pole.');
              };
            }

            const fatBtn = document.getElementById(`olt-pop-fat-${eq.id}`);
            if (fatBtn) {
              fatBtn.onclick = (e) => {
                e.stopPropagation();
                marker.closePopup();
                setSelectedEquipmentTypeToAdd('FAT');
                setActiveTool('add_equipment');
                showToast('info', 'Place Street Box (FAT)', 'Click on the map where customer homes can plug in.');
              };
            }

            const portsBtn = document.getElementById(`olt-pop-ports-${eq.id}`);
            if (portsBtn) {
              portsBtn.onclick = (e) => {
                e.stopPropagation();
                marker.closePopup();
                setSelectedObject({ type: 'equipment', data: eq });
                setPanelOpen('right', true);
                setModalOpen('portManager', true);
              };
            }
          }, 50);
        });
      }

      marker.on('click', () => {
        setSelectedObject({ type: 'equipment', data: eq });
        setPanelOpen('right', true);
        if (eq.type === 'OLT') {
          setActiveOltModal(eq);
          marker.openPopup();
        }
      });

      marker.addTo(group);
    });
  }, [
    equipments,
    activeTraceEquipmentIds,
    activeLayers,
    networkMode,
    oltTechFilter,
    setSelectedObject,
    setPanelOpen,
    setSelectedCableTypeToDraw,
    setActiveDrawingPoints,
    setActiveTool,
    setSelectedEquipmentTypeToAdd,
    setModalOpen,
    showToast,
  ]);

  // Update marker selected state without recreating markers or destroying popups
  useEffect(() => {
    markerMapRef.current.forEach((marker, eqId) => {
      const eq = equipments.find((e) => e.id === eqId);
      if (!eq) return;
      const isSelected = selectedObject?.type === 'equipment' && selectedObject.data.id === eqId;
      const isTraced = activeTraceEquipmentIds.includes(eqId);
      marker.setIcon(createCustomMarkerIcon(eq.type, eq.status, isSelected, isTraced, eq.technology));
    });
  }, [selectedObject, activeTraceEquipmentIds, equipments]);

  // Render Cables
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const group = cableLayerGroupRef.current;
    group.clearLayers();

    cables.forEach((cable) => {
      if (networkMode === 'Fiber' && cable.cableCategory === 'Coaxial') return;
      if (networkMode === 'CableTV' && cable.cableCategory === 'Fiber') return;

      // Layer visibility filter
      if (cable.type === 'Main Feeder Fiber' && !activeLayers.feederCable) return;
      if (cable.type === 'Distribution Fiber' && !activeLayers.distributionCable) return;
      if (cable.type === 'Drop Fiber' && !activeLayers.dropCable) return;
      if (cable.type === 'Underground Fiber' && !activeLayers.undergroundCable) return;
      if (cable.type === 'Aerial Fiber' && !activeLayers.aerialCable) return;
      if (cable.type === 'Coaxial Cable' && !activeLayers.coaxialCable) return;

      const isSelected = selectedObject?.type === 'cable' && selectedObject.data.id === cable.id;
      const isTraced = activeTraceCableIds.includes(cable.id);

      const styleDef = cableStyle(cable.type);

      // Background halo for trace or selection
      if (isTraced || isSelected) {
        const halo = L.polyline(cable.coordinates, {
          color: isTraced ? '#10b981' : '#3b82f6',
          weight: styleDef.strokeWidth + 8,
          opacity: 0.6,
          className: isTraced ? 'fiber-trace-active' : '',
        });
        halo.addTo(group);
      }

      const polyline = L.polyline(cable.coordinates, {
        color: isTraced ? '#059669' : isSelected ? '#1d4ed8' : styleDef.stroke,
        weight: isSelected ? styleDef.strokeWidth + 2 : styleDef.strokeWidth,
        dashArray: styleDef.dashArray,
        opacity: cable.status === 'Damaged' ? 0.6 : 0.95,
      });

      polyline.bindTooltip(
        `
        <div class="text-xs">
          <div class="font-bold text-sky-400">${cable.id}</div>
          <div class="font-medium">${cable.name}</div>
          <div class="text-[10px] text-slate-300">${cable.type} &bull; ${cable.fiberCount} Cores &bull; ${cable.lengthMeters}m</div>
        </div>
      `,
        {
          direction: 'center',
          className: 'gis-tooltip',
        },
      );

      const popupHtml = `
        <div style="font-family: system-ui, -apple-system, sans-serif; min-width: 220px; padding: 4px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px;">
            <span style="font-size: 10px; font-weight: 800; color: #0284c7; text-transform: uppercase;">FTTH Cable Route</span>
            <span style="font-size: 10px; font-weight: 700; background: #e0f2fe; color: #0369a1; padding: 2px 6px; border-radius: 4px;">${cable.fiberCount || 24} Cores</span>
          </div>
          <div style="font-weight: 800; font-size: 13px; color: #0f172a; margin-bottom: 2px;">${cable.name || cable.id}</div>
          <div style="font-size: 11px; color: #64748b; margin-bottom: 10px;">
            ${cable.type} &bull; ${Math.round(cable.lengthMeters || 0)}m
          </div>
          <button id="del-cable-btn-${cable.id}" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px; background: #dc2626; color: #ffffff; border: none; border-radius: 8px; padding: 7px 12px; font-size: 12px; font-weight: 700; cursor: pointer; box-shadow: 0 1px 3px rgba(220,38,38,0.3); transition: background 0.15s ease;">
            <span>🗑️ Delete Wire Route</span>
          </button>
        </div>
      `;

      polyline.bindPopup(popupHtml, {
        className: 'cable-quick-popup',
        offset: [0, -4],
      });

      polyline.on('popupopen', () => {
        setTimeout(() => {
          const btn = document.getElementById(`del-cable-btn-${cable.id}`);
          if (btn) {
            btn.onclick = (e) => {
              e.stopPropagation();
              polyline.closePopup();
              deleteCable(cable.id);
              setSelectedObject(null);
              showToast('success', 'Wire Route Deleted', `Successfully deleted ${cable.name || cable.id} from map.`);
            };
          }
        }, 50);
      });

      polyline.on('click', () => {
        setSelectedObject({ type: 'cable', data: cable });
        setPanelOpen('right', true);
      });

      polyline.addTo(group);
    });
  }, [
    cables,
    selectedObject,
    activeTraceCableIds,
    activeLayers,
    networkMode,
    setSelectedObject,
    deleteCable,
    showToast,
    setPanelOpen,
  ]);

  // Render Customers
  useEffect(() => {
    if (!mapInstanceRef.current || !activeLayers.customers || networkMode === 'CableTV') {
      customerLayerGroupRef.current.clearLayers();
      return;
    }
    const group = customerLayerGroupRef.current;
    group.clearLayers();

    customers.forEach((cust) => {
      const isSelected = selectedObject?.type === 'customer' && selectedObject.data.id === cust.id;
      const marker = L.marker([cust.lat, cust.lng], {
        icon: createCustomerMarkerIcon(cust.status, isSelected),
      });

      marker.bindTooltip(
        `
        <div class="text-xs">
          <div class="font-bold text-emerald-400">${cust.name} (${cust.id})</div>
          <div class="text-[11px]">${cust.plan}</div>
          <div class="text-[10px] text-slate-300">Terminal: ${cust.terminalBoxId} &bull; Splitter: ${cust.splitterId} (Port ${cust.splitterOutputPort})</div>
        </div>
      `,
        {
          direction: 'top',
          className: 'gis-tooltip',
          offset: [0, -12],
        },
      );

      marker.on('click', () => {
        setSelectedObject({ type: 'customer', data: cust });
        setPanelOpen('right', true);
      });

      marker.addTo(group);
    });
  }, [customers, selectedObject, activeLayers.customers, networkMode, setSelectedObject]);

  // Render Fault Markers
  useEffect(() => {
    if (!mapInstanceRef.current || !activeLayers.faults) {
      faultLayerGroupRef.current.clearLayers();
      return;
    }
    const group = faultLayerGroupRef.current;
    group.clearLayers();

    faults
      .filter((f) => f.status !== 'Resolved')
      .forEach((fault) => {
        const faultIcon = L.divIcon({
          html: `
          <div class="relative flex items-center justify-center w-8 h-8">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
            <div class="relative inline-flex rounded-full h-7 w-7 bg-rose-600 border-2 border-white items-center justify-center text-white shadow-lg">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            </div>
          </div>
        `,
          className: 'gis-fault-marker',
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });

        const marker = L.marker([fault.affectedLocation.lat, fault.affectedLocation.lng], {
          icon: faultIcon,
        });

        marker.bindTooltip(
          `
        <div class="text-xs">
          <div class="font-bold text-rose-400">${fault.id} [${fault.severity}]</div>
          <div class="font-medium">${fault.title}</div>
          <div class="text-[10px] text-slate-300">${fault.affectedCustomerIds.length} Downstream Customers Affected</div>
        </div>
      `,
          {
            direction: 'top',
            className: 'gis-tooltip',
          },
        );

        marker.on('click', () => {
          setSelectedObject({ type: 'fault', data: fault });
          setPanelOpen('right', true);
        });

        marker.addTo(group);
      });
  }, [faults, selectedObject, activeLayers.faults, setSelectedObject]);

  // Render Biker Motorcycle Navigation Road Route
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const group = bikerLayerGroupRef.current;
    group.clearLayers();

    if (!isBikerMode || !bikerRoute || !bikerRoute.coordinates || bikerRoute.coordinates.length < 2) {
      return;
    }

    // 1. Dark road track casing for high-contrast visibility against all map styles
    const casing = L.polyline(bikerRoute.coordinates, {
      color: '#431407',
      weight: 8,
      opacity: 0.85,
      lineCap: 'round',
      lineJoin: 'round',
    });
    casing.addTo(group);

    // 2. High-visibility orange dashed motorcycle navigation line
    const roadLine = L.polyline(bikerRoute.coordinates, {
      color: '#f97316',
      weight: 4.5,
      dashArray: '10, 8',
      opacity: 1,
    });

    roadLine.bindTooltip(
      `
      <div class="text-xs font-sans">
        <div class="font-bold text-orange-400 flex items-center gap-1.5">
          <span>🏍️ Biker Road Navigation</span>
          <span class="bg-orange-950/80 text-orange-300 px-1.5 py-0.2 rounded text-[10px]">OSRM Road Profile</span>
        </div>
        <div class="font-medium text-white mt-0.5">
          ${(bikerRoute.distanceMeters / 1000).toFixed(2)} km &bull; ~${Math.max(1, Math.ceil(bikerRoute.durationSeconds / 60))} min travel
        </div>
        <div class="text-[10px] text-orange-200 mt-0.5">
          Actual road traffic path (distinct from fiber cable route)
        </div>
      </div>
    `,
      {
        sticky: true,
        className: 'gis-tooltip',
      },
    );
    roadLine.addTo(group);

    // 3. Start Marker (Motorcycle / Origin icon)
    const startPt = bikerRoute.coordinates[0];
    const startIcon = L.divIcon({
      html: `
        <div class="relative flex items-center justify-center w-9 h-9">
          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
          <div class="relative w-8 h-8 rounded-full bg-orange-600 border-2 border-white flex items-center justify-center text-white shadow-xl">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>
          </div>
        </div>
      `,
      className: 'gis-biker-origin-marker',
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });
    L.marker(startPt, { icon: startIcon })
      .bindTooltip('Motorcycle Departure Point (Technician Origin)', { direction: 'top', className: 'gis-tooltip' })
      .addTo(group);

    // 4. Intermediate waypoints (if multi-stop route)
    if (bikerWaypoints.length > 1) {
      bikerWaypoints.slice(0, -1).forEach((wp, idx) => {
        const wpIcon = L.divIcon({
          html: `
            <div class="w-6 h-6 rounded-full bg-amber-500 border-2 border-white flex items-center justify-center text-white text-[10px] font-bold shadow-md">
              ${idx + 1}
            </div>
          `,
          className: 'gis-biker-wp-marker',
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });
        L.marker([wp.lat, wp.lng], { icon: wpIcon })
          .bindTooltip(`Stop ${idx + 1}: ${wp.name || wp.id}`, { direction: 'top', className: 'gis-tooltip' })
          .addTo(group);
      });
    }

    // 5. Destination Flag Marker
    const endPt = bikerRoute.coordinates[bikerRoute.coordinates.length - 1];
    const endIcon = L.divIcon({
      html: `
        <div class="relative flex items-center justify-center w-8 h-8">
          <div class="w-8 h-8 rounded-full bg-emerald-600 border-2 border-white flex items-center justify-center text-white shadow-xl animate-bounce">
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
          </div>
        </div>
      `,
      className: 'gis-biker-dest-marker',
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
    L.marker(endPt, { icon: endIcon })
      .bindTooltip('Target Network Asset Destination', { direction: 'top', className: 'gis-tooltip' })
      .addTo(group);

    // Auto-fit bounds
    try {
      const bounds = L.latLngBounds(bikerRoute.coordinates);
      mapInstanceRef.current.fitBounds(bounds, { padding: [70, 70], maxZoom: 17 });
    } catch (e) {
      // bounds fit fallback
    }
  }, [isBikerMode, bikerRoute, bikerWaypoints]);

  // Snapping logic: find nearest equipment or pole within 25 meters
  const findSnapTarget = useCallback(
    (lat: number, lng: number): { lat: number; lng: number; id: string; name: string; dist: number } | null => {
      let nearest: { lat: number; lng: number; id: string; name: string; dist: number } | null = null;
      equipments.forEach((eq) => {
        const dLat = (eq.lat - lat) * 111000;
        const dLng = (eq.lng - lng) * 111000 * Math.cos((lat * Math.PI) / 180);
        const dist = Math.sqrt(dLat * dLat + dLng * dLng);
        if (dist < 30) {
          // within 30 meters
          if (!nearest || dist < nearest.dist) {
            nearest = { lat: eq.lat, lng: eq.lng, id: eq.id, name: eq.name, dist };
          }
        }
      });
      return nearest;
    },
    [equipments],
  );

  // Interactive Map Click Handler (Drawing, Placing Equipment, Measuring)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const handleMapClick = (e: L.LeafletMouseEvent) => {
      let lat = e.latlng.lat;
      let lng = e.latlng.lng;

      // Apply snap if active
      const snapped = findSnapTarget(lat, lng);
      if (snapped !== null) {
        lat = snapped.lat;
        lng = snapped.lng;
        setSnapTarget(snapped);
      } else {
        setSnapTarget(null);
        if (activeTool === 'select') {
          setSelectedObject(null);
          setPanelOpen('right', false);
        }
      }

      if (activeTool === 'draw_cable') {
        setActiveDrawingPoints((prev) => [...prev, [lat, lng]]);

        // If Auto-Drop Pole is active and point didn't snap to existing equipment, place a utility pole automatically
        if (autoAddPolesOnDraw && !snapped) {
          const poleCount = equipments.filter((eq) => eq.type.includes('Pole')).length + 1;
          const poleName = `Pole-${poleCount.toString().padStart(2, '0')}`;
          addEquipment({
            name: poleName,
            type: 'Telecom Pole',
            lat,
            lng,
            category: 'Supporting Infrastructure',
          });
          showToast('success', 'Pole Added ⚡', `${poleName} placed along wire path`);
        }
      } else if (activeTool === 'measure') {
        setMeasuringPoints((prev) => [...prev, [lat, lng]]);
      } else if (activeTool === 'add_equipment' && selectedEquipmentTypeToAdd) {
        // Place new equipment directly
        const created = addEquipment({
          name: `New ${selectedEquipmentTypeToAdd}`,
          type: selectedEquipmentTypeToAdd,
          lat,
          lng,
          category: categoryForType(selectedEquipmentTypeToAdd),
        });
        if (created) {
          setSelectedObject({ type: 'equipment', data: created });
          setActiveTool('select');
        }
      }
    };

    const handleMouseMove = (e: L.LeafletMouseEvent) => {
      const lat = e.latlng.lat;
      const lng = e.latlng.lng;
      const snapped = findSnapTarget(lat, lng);
      if (snapped !== null) {
        setTempMousePos([snapped.lat, snapped.lng]);
        setSnapTarget(snapped);
      } else {
        setTempMousePos([lat, lng]);
        setSnapTarget(null);
      }
    };

    map.on('click', handleMapClick);
    map.on('mousemove', handleMouseMove);

    return () => {
      map.off('click', handleMapClick);
      map.off('mousemove', handleMouseMove);
    };
  }, [
    activeTool,
    selectedEquipmentTypeToAdd,
    findSnapTarget,
    addEquipment,
    setActiveDrawingPoints,
    setMeasuringPoints,
    setSelectedObject,
    setActiveTool,
    autoAddPolesOnDraw,
    equipments,
    showToast,
  ]);

  // Render Drawing & Measuring Previews
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const group = drawLayerGroupRef.current;
    group.clearLayers();

    // Drawing Cable Line
    if (activeDrawingPoints.length > 0) {
      // Draw points as markers
      activeDrawingPoints.forEach((pt, idx) => {
        const isEnd = idx === 0 || idx === activeDrawingPoints.length - 1;
        const ptMarker = L.circleMarker(pt, {
          radius: isEnd ? 7 : 5,
          color: '#2563eb',
          fillColor: isEnd ? '#3b82f6' : '#ffffff',
          fillOpacity: 1,
          weight: 2,
        });
        ptMarker.addTo(group);
      });

      // Draw polyline through points
      const fullPoints = [...activeDrawingPoints];
      if (tempMousePos && activeTool === 'draw_cable') {
        fullPoints.push(tempMousePos);
      }

      const drawLine = L.polyline(fullPoints, {
        color: '#0284c7',
        weight: 4,
        dashArray: '6, 6',
        opacity: 0.8,
      });
      drawLine.addTo(group);

      // Calculate distance
      let totalMeters = 0;
      for (let i = 0; i < fullPoints.length - 1; i++) {
        const [lat1, lon1] = fullPoints[i];
        const [lat2, lon2] = fullPoints[i + 1];
        totalMeters += L.latLng(lat1, lon1).distanceTo(L.latLng(lat2, lon2));
      }
      setCumulativeDistance(Math.round(totalMeters));
    }

    // Measuring Line
    if (measuringPoints.length > 0) {
      measuringPoints.forEach((pt) => {
        L.circleMarker(pt, {
          radius: 5,
          color: '#d97706',
          fillColor: '#f59e0b',
          fillOpacity: 0.9,
          weight: 2,
        }).addTo(group);
      });

      const fullMeas = [...measuringPoints];
      if (tempMousePos && activeTool === 'measure') {
        fullMeas.push(tempMousePos);
      }

      L.polyline(fullMeas, {
        color: '#f59e0b',
        weight: 3,
        dashArray: '4, 4',
      }).addTo(group);

      let totalMeters = 0;
      for (let i = 0; i < fullMeas.length - 1; i++) {
        totalMeters += L.latLng(fullMeas[i][0], fullMeas[i][1]).distanceTo(
          L.latLng(fullMeas[i + 1][0], fullMeas[i + 1][1]),
        );
      }
      setCumulativeDistance(Math.round(totalMeters));
    }

    // Snapping Target Ring
    if (snapTarget) {
      L.circleMarker([snapTarget.lat, snapTarget.lng], {
        radius: 12,
        color: '#10b981',
        fillColor: '#34d399',
        fillOpacity: 0.3,
        weight: 2.5,
      }).addTo(group);
    }
  }, [activeDrawingPoints, measuringPoints, tempMousePos, activeTool, snapTarget]);

  // Current Location Geolocation (100% Free, Browser Native GPS)
  const handleGetCurrentLocation = () => {
    if (!navigator.geolocation) {
      showToast('error', 'GPS Unavailable', 'Geolocation is not supported by your browser.');
      return;
    }

    setIsLocating(true);
    showToast('info', 'Finding Location', 'Detecting your current GPS coordinates...');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setIsLocating(false);
        const { latitude, longitude, accuracy } = position.coords;

        if (!mapInstanceRef.current) return;
        const map = mapInstanceRef.current;

        // Clear previous user location markers
        userLocationLayerRef.current.clearLayers();

        // Create animated pulsing GPS dot
        const gpsIcon = L.divIcon({
          className: 'user-gps-marker',
          html: `
            <div style="position:relative; width:28px; height:28px; display:flex; align-items:center; justify-content:center;">
              <div style="position:absolute; width:28px; height:28px; border-radius:50%; background-color:rgba(37,99,235,0.35); animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
              <div style="width:16px; height:16px; border-radius:50%; background-color:#2563eb; border:3px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.35); position:relative; z-index:10;"></div>
            </div>
          `,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });

        const userMarker = L.marker([latitude, longitude], { icon: gpsIcon });
        userMarker.bindPopup(`
          <div style="font-family: system-ui, -apple-system, sans-serif; font-size: 13px; line-height: 1.5; padding: 4px;">
            <div style="color: #1e40af; font-weight: 700; font-size: 14px; margin-bottom: 2px;">📍 You Are Here</div>
            <div style="color: #475569; font-size: 12px;"><strong>Lat:</strong> ${latitude.toFixed(6)}</div>
            <div style="color: #475569; font-size: 12px;"><strong>Lng:</strong> ${longitude.toFixed(6)}</div>
            <div style="color: #16a34a; font-size: 11px; margin-top: 4px; font-weight: 600;">Accuracy: &plusmn;${Math.round(accuracy)} meters</div>
          </div>
        `);

        // Accuracy circle
        const accuracyCircle = L.circle([latitude, longitude], {
          radius: Math.max(accuracy, 25),
          color: '#2563eb',
          fillColor: '#3b82f6',
          fillOpacity: 0.12,
          weight: 1.5,
          dashArray: '4, 4',
        });

        userLocationLayerRef.current.addLayer(accuracyCircle);
        userLocationLayerRef.current.addLayer(userMarker);

        // Smooth fly to current location
        map.flyTo([latitude, longitude], 17, {
          duration: 1.5,
        });

        setTimeout(() => {
          userMarker.openPopup();
        }, 1500);

        if (accuracy > 80) {
          showToast(
            'warning',
            'Location Accuracy Notice',
            `GPS accuracy is ±${Math.round(accuracy)}m. You can manually adjust coordinates if required.`,
          );
        } else {
          showToast(
            'success',
            'GPS Location Locked',
            `Coordinates: ${latitude.toFixed(6)}, ${longitude.toFixed(6)} (±${Math.round(accuracy)}m)`,
          );
        }
      },
      (error) => {
        setIsLocating(false);
        let errorMsg = 'Could not retrieve your location.';
        if (error.code === error.PERMISSION_DENIED) {
          errorMsg = 'Location permission was denied. Please allow location access in your browser address bar.';
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          errorMsg = 'GPS position is currently unavailable.';
        } else if (error.code === error.TIMEOUT) {
          errorMsg = 'GPS location request timed out.';
        }
        showToast('error', 'Location Error', errorMsg);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      },
    );
  };

  // Particular Action: Add Utility Pole at Wire Point
  const handleAddPoleAtCurrentPoint = () => {
    let targetCoords: [number, number] | null = null;
    if (activeDrawingPoints.length > 0) {
      targetCoords = activeDrawingPoints[activeDrawingPoints.length - 1];
    } else if (tempMousePos) {
      targetCoords = tempMousePos;
      setActiveDrawingPoints([tempMousePos]);
    }

    if (!targetCoords) {
      showToast(
        'warning',
        'No Point Selected',
        'Click on the road first to place a wire point, then click + Add Pole.',
      );
      return;
    }

    const poleCount = equipments.filter((eq) => eq.type.includes('Pole')).length + 1;
    const poleName = `Pole-${poleCount.toString().padStart(2, '0')}`;
    const newPole = addEquipment({
      name: poleName,
      type: 'Telecom Pole',
      lat: targetCoords[0],
      lng: targetCoords[1],
      category: 'Supporting Infrastructure',
    });

    if (newPole) {
      showToast(
        'success',
        'Utility Pole Added! ⚡',
        `${poleName} placed at wire point. Wire is now mounted on this pole!`,
      );
    }
  };

  // Keyboard shortcut: Press 'P' while drawing wire to drop a pole
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeTool === 'draw_cable' && (e.key === 'p' || e.key === 'P')) {
        handleAddPoleAtCurrentPoint();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTool, activeDrawingPoints, tempMousePos, equipments]);

  // Finalize Drawing Cable Route
  const handleFinishDrawingCable = () => {
    if (activeDrawingPoints.length < 2) {
      showToast('warning', 'Incomplete Route', 'Click at least two points on the map to define the cable route.');
      return;
    }
    // Launch wizard with prefilled coordinates
    setModalOpen('cableWizard', true);
  };

  const handleCancelDrawing = () => {
    setActiveDrawingPoints([]);
    setMeasuringPoints([]);
    setActiveTool('select');
  };

  // Drag and drop onto map support
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (!mapInstanceRef.current) return;
    const type = e.dataTransfer.getData('application/fiber-equipment-type') as EquipmentType;
    if (!type) return;

    const rect = mapContainerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const latlng = mapInstanceRef.current.containerPointToLatLng([x, y]);

    const created = addEquipment({
      name: `New ${type}`,
      type,
      lat: latlng.lat,
      lng: latlng.lng,
      category: categoryForType(type),
    });

    if (created) {
      setSelectedObject({ type: 'equipment', data: created });
    }
  };

  return (
    <div
      className="relative w-full h-full overflow-hidden bg-slate-100 select-none"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Map Container */}
      <div ref={mapContainerRef} className="w-full h-full" />

      {/* Map toolbar */}
      <MapToolbar isBikerMode={isBikerMode} onToggleBikerMode={() => setIsBikerMode(!isBikerMode)} />

      <MapModeBar
        distanceMeters={cumulativeDistance}
        snapTargetName={snapTarget?.name ?? null}
        autoPole={autoAddPolesOnDraw}
        onAutoPoleChange={setAutoAddPolesOnDraw}
        onAddPole={handleAddPoleAtCurrentPoint}
        onFinish={handleFinishDrawingCable}
        onCancel={handleCancelDrawing}
      />

      <MapControls
        onZoomIn={() => mapInstanceRef.current?.zoomIn()}
        onZoomOut={() => mapInstanceRef.current?.zoomOut()}
        onLocate={handleGetCurrentLocation}
        isLocating={isLocating}
        onResetView={() =>
          mapInstanceRef.current?.flyTo([DEFAULT_VIEWPORT.lat, DEFAULT_VIEWPORT.lng], DEFAULT_VIEWPORT.zoom)
        }
      />

      <OltFilterControl
        value={oltTechFilter}
        onChange={setOltTechFilter}
        counts={{
          All: equipments.filter((e) => e.type === 'OLT').length,
          GPON: equipments.filter((e) => e.type === 'OLT' && (e.technology || 'GPON') === 'GPON').length,
          EPON: equipments.filter((e) => e.type === 'OLT' && e.technology === 'EPON').length,
        }}
      />

      {/* On-Map Floating OLT Quick-Action Modal Popup */}
      {activeOltModal && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[500] w-[94%] max-w-lg bg-white/98 backdrop-blur-xl rounded-2xl shadow-2xl border-2 border-blue-500/40 p-4 animate-in fade-in zoom-in-95">
          {/* Header */}
          <div className="flex items-start justify-between border-b border-slate-100 pb-3 mb-3">
            <div className="flex items-center gap-3">
              <div className="bg-slate-900 p-2 rounded-xl border border-slate-800 shadow-sm shrink-0">
                <OltChassisIcon
                  width={50}
                  height={26}
                  status={activeOltModal.status}
                  isSelected={true}
                  technology={activeOltModal.technology || 'GPON'}
                />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-extrabold text-blue-600 uppercase tracking-wider">
                  Central Internet Hub
                </div>
                <div className="text-sm font-bold text-slate-900 leading-tight truncate">
                  {activeOltModal.name || activeOltModal.id}
                </div>
                <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-600">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    16 PON Ports Active
                  </span>
                  <span>&bull;</span>
                  <span>
                    {activeOltModal.manufacturer || 'Huawei'} {activeOltModal.model || 'MA5800'}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wider border ${
                      (activeOltModal.technology || 'GPON') === 'EPON'
                        ? 'bg-purple-100 text-purple-800 border-purple-300'
                        : 'bg-blue-100 text-blue-800 border-blue-300'
                    }`}
                  >
                    {activeOltModal.technology || 'GPON'} OLT
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {(activeOltModal.technology || 'GPON') === 'EPON'
                      ? 'IEEE 802.3ah (1.25G/1.25G)'
                      : 'ITU-T G.984 (2.5G/1.25G)'}
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={() => setActiveOltModal(null)}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors shrink-0"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* PON Technology Selector (GPON vs EPON) */}
          <div className="bg-slate-50/90 rounded-xl p-2.5 border border-slate-200/90 mb-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Cpu className="w-4 h-4 text-blue-600" />
                <span>PON Standard Option:</span>
              </span>
              <span className="text-[10px] text-slate-500">Click to switch standard</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  const updated: Equipment = { ...activeOltModal, technology: 'GPON' };
                  updateEquipment(updated);
                  setActiveOltModal(updated);
                  showToast('success', 'Configured as GPON', `${activeOltModal.name} set to GPON (ITU-T G.984).`);
                }}
                className={`p-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border transition-all ${
                  (activeOltModal.technology || 'GPON') === 'GPON'
                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm ring-2 ring-blue-300'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-blue-50 hover:text-blue-700'
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full bg-blue-300"></span>
                <span>🔵 GPON OLT</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const updated: Equipment = { ...activeOltModal, technology: 'EPON' };
                  updateEquipment(updated);
                  setActiveOltModal(updated);
                  showToast('success', 'Configured as EPON', `${activeOltModal.name} set to EPON (IEEE 802.3ah).`);
                }}
                className={`p-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border transition-all ${
                  activeOltModal.technology === 'EPON'
                    ? 'bg-purple-600 text-white border-purple-600 shadow-sm ring-2 ring-purple-300'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-purple-50 hover:text-purple-700'
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full bg-purple-300"></span>
                <span>🟣 EPON OLT</span>
              </button>
            </div>

            <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-200/60">
              <span className="text-slate-500">Filter map:</span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setOltTechFilter('GPON');
                    showToast('info', 'Filtered GPON', 'Only GPON OLTs shown on map.');
                  }}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${oltTechFilter === 'GPON' ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700 hover:bg-blue-100'}`}
                >
                  Show GPON Only
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOltTechFilter('EPON');
                    showToast('info', 'Filtered EPON', 'Only EPON OLTs shown on map.');
                  }}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${oltTechFilter === 'EPON' ? 'bg-purple-600 text-white' : 'bg-slate-200 text-slate-700 hover:bg-purple-100'}`}
                >
                  Show EPON Only
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOltTechFilter('All');
                    showToast('info', 'All OLTs', 'All OLTs shown on map.');
                  }}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${oltTechFilter === 'All' ? 'bg-slate-700 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}
                >
                  All OLTs
                </button>
              </div>
            </div>
          </div>

          <div className="text-xs font-bold text-slate-700 mb-2.5 flex items-center gap-1.5">
            <Zap className="w-4 h-4 text-amber-500 fill-amber-500" />
            <span>Connect & Add Components from this OLT:</span>
          </div>

          {/* Action Buttons Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {/* 1. Draw Wire */}
            <button
              onClick={() => {
                const olt = activeOltModal;
                setActiveOltModal(null);
                setSelectedCableTypeToDraw('Main Feeder Fiber');
                setActiveDrawingPoints([[olt.lat, olt.lng]]);
                setActiveTool('draw_cable');
                showToast(
                  'info',
                  'Drawing Feeder Wire',
                  `Started wire from ${olt.name}. Click along the street or poles!`,
                );
              }}
              className="p-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-xs flex items-center gap-2.5 shadow-md shadow-blue-500/20 text-left transition-all active:scale-98"
            >
              <Activity className="w-5 h-5 shrink-0" />
              <div>
                <div className="font-extrabold text-[13px]">⚡ Draw Wire from OLT</div>
                <div className="text-[10px] text-blue-100 font-normal">Connect feeder cable along road</div>
              </div>
            </button>

            {/* 2. Add Pole */}
            <button
              onClick={() => {
                setActiveOltModal(null);
                setSelectedEquipmentTypeToAdd('Telecom Pole');
                setActiveTool('add_equipment');
                showToast('info', 'Place Utility Pole', 'Click on the map near the road to place a utility pole.');
              }}
              className="p-3 bg-amber-50 hover:bg-amber-100 text-amber-900 rounded-xl font-bold text-xs flex items-center gap-2.5 border border-amber-200 text-left transition-all active:scale-98"
            >
              <Zap className="w-5 h-5 text-amber-600 fill-amber-600 shrink-0" />
              <div>
                <div className="font-extrabold text-[13px]">+ Place Utility Pole</div>
                <div className="text-[10px] text-amber-700 font-normal">Mount overhead wire on pole</div>
              </div>
            </button>

            {/* 3. Add FAT Box */}
            <button
              onClick={() => {
                setActiveOltModal(null);
                setSelectedEquipmentTypeToAdd('FAT');
                setActiveTool('add_equipment');
                showToast('info', 'Place Street Box (FAT)', 'Click on the map where customer homes can plug in.');
              }}
              className="p-3 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-xl font-bold text-xs flex items-center gap-2.5 border border-emerald-200 text-left transition-all active:scale-98"
            >
              <div className="w-6 h-6 rounded-md bg-emerald-600 text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                FAT
              </div>
              <div>
                <div className="font-extrabold text-[13px]">+ Add Street Box (FAT)</div>
                <div className="text-[10px] text-emerald-700 font-normal">8-port home distribution box</div>
              </div>
            </button>

            {/* 4. Inspect Ports & Power */}
            <button
              onClick={() => {
                const olt = activeOltModal;
                setActiveOltModal(null);
                setSelectedObject({ type: 'equipment', data: olt });
                setPanelOpen('right', true);
                setModalOpen('portManager', true);
              }}
              className="p-3 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl font-bold text-xs flex items-center gap-2.5 border border-slate-200 text-left transition-all active:scale-98"
            >
              <Grid className="w-5 h-5 text-slate-700 shrink-0" />
              <div>
                <div className="font-extrabold text-[13px]">Manage 16 PON Ports</div>
                <div className="text-[10px] text-slate-500 font-normal">Check sockets & optical dBm</div>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Floating Technician Biker Mode Navigation Overlay */}
      <BikerModePanel />
    </div>
  );
};
