import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bike,
  Check,
  ChevronRight,
  Clock,
  Compass,
  CornerUpLeft,
  Crosshair,
  FolderOpen,
  Layers,
  MapPin,
  Navigation,
  Pause,
  Play,
  Plus,
  Route,
  Save,
  Split,
  Square,
  Trash2,
  UtilityPole,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { type CableType, DEFAULT_OPTICAL_SETTINGS, type Equipment, type EquipmentType } from '@fibergis/shared';

import { currentGpsPosition, gpsFailureMessage } from '../../lib/browser';
import { useBikerStore } from '../../stores/bikerStore';
import { useMapStore } from '../../stores/mapStore';
import { addEquipment } from '../../stores/networkActions';
import { useNetworkStore } from '../../stores/networkStore';
import { showToast } from '../../stores/toastStore';
import { useUiStore } from '../../stores/uiStore';
import { nextPoleName } from '../map/sketch/poleNaming';

type SplitRatio = '1:2' | '1:4' | '1:8' | '1:16' | '1:32' | 'ratio_90_10';
type SlackLength = 10 | 20 | 30 | 50;
type PoleTypeChoice = 'Telecom Pole' | 'Electric Pole';

const OPTICAL = DEFAULT_OPTICAL_SETTINGS;
const SPLIT_SPECS: Record<SplitRatio, { label: string; ports: number; lossDb: number; desc: string }> = {
  '1:2': { label: '1:2 (2 Ports)', ports: 2, lossDb: OPTICAL.splitterDb['1:2'], desc: `Balanced optical split ~${OPTICAL.splitterDb['1:2']} dB` },
  '1:4': { label: '1:4 (4 Ports)', ports: 4, lossDb: OPTICAL.splitterDb['1:4'], desc: `Balanced optical split ~${OPTICAL.splitterDb['1:4']} dB` },
  '1:8': { label: '1:8 (8 Ports)', ports: 8, lossDb: OPTICAL.splitterDb['1:8'], desc: `Standard distribution split ~${OPTICAL.splitterDb['1:8']} dB` },
  '1:16': { label: '1:16 (16 Ports)', ports: 16, lossDb: OPTICAL.splitterDb['1:16'], desc: `High-density split ~${OPTICAL.splitterDb['1:16']} dB` },
  '1:32': { label: '1:32 (32 Ports)', ports: 32, lossDb: OPTICAL.splitterDb['1:32'], desc: `Centralized GPON split ~${OPTICAL.splitterDb['1:32']} dB` },
  ratio_90_10: { label: '90/10 Ratio Coupler', ports: 2, lossDb: OPTICAL.couplers['90/10'].tapDb, desc: 'Unbalanced tap (90% through, 10% tap)' },
};

export const BikerModePanel: React.FC = () => {
  const {
    isBikerMode,
    setIsBikerMode,
    bikerRoute,
    bikerWaypoints,
    addBikerWaypoint,
    clearBikerRoute,
    navigateToAsset,
    // Live GPS state & actions
    trackingStatus,
    livePosition,
    trackedCoordinates,
    distanceKm,
    elapsedSeconds,
    gpsAccuracy,
    gpsError,
    startLiveTracking,
    pauseLiveTracking,
    resumeLiveTracking,
    stopLiveTracking,
    saveLiveRoute,
    clearLiveRoute,
    setSavedRoutesModalOpen,
    activeTab,
    setActiveTab,
  } = useBikerStore(
    useShallow((s) => ({
      isBikerMode: s.isBikerMode,
      setIsBikerMode: s.setBikerMode,
      activeTab: s.activeBikerTab,
      setActiveTab: s.setActiveBikerTab,
      bikerRoute: s.route,
      bikerWaypoints: s.waypoints,
      addBikerWaypoint: s.addWaypoint,
      clearBikerRoute: s.clearRoute,
      navigateToAsset: s.navigateTo,
      trackingStatus: s.trackingStatus,
      livePosition: s.livePosition,
      trackedCoordinates: s.trackedCoordinates,
      distanceKm: s.distanceKm,
      elapsedSeconds: s.elapsedSeconds,
      gpsAccuracy: s.gpsAccuracy,
      gpsError: s.gpsError,
      startLiveTracking: s.startLiveTracking,
      pauseLiveTracking: s.pauseLiveTracking,
      resumeLiveTracking: s.resumeLiveTracking,
      stopLiveTracking: s.stopLiveTracking,
      saveLiveRoute: s.saveLiveRoute,
      clearLiveRoute: s.clearLiveRoute,
      setSavedRoutesModalOpen: s.setSavedRoutesModalOpen,
    })),
  );

  const { equipments, customers, faults, gpsRoutes } = useNetworkStore(
    useShallow((s) => ({
      equipments: s.equipment,
      customers: s.customers,
      faults: s.faults,
      gpsRoutes: s.gpsRoutes || [],
    })),
  );

  const {
    activeTool,
    setActiveTool,
    equipmentTypeToAdd,
    setEquipmentTypeToAdd,
    setEquipmentDraftTemplate,
    drawingPoints,
    setDrawingPoints,
    viewport,
    flyTo,
    setCableTypeToDraw,
    cableTypeToDraw,
  } = useMapStore(
    useShallow((s) => ({
      activeTool: s.activeTool,
      setActiveTool: s.setActiveTool,
      equipmentTypeToAdd: s.equipmentTypeToAdd,
      setEquipmentTypeToAdd: s.setEquipmentTypeToAdd,
      setEquipmentDraftTemplate: s.setEquipmentDraftTemplate,
      drawingPoints: s.drawingPoints,
      setDrawingPoints: s.setDrawingPoints,
      viewport: s.viewport,
      flyTo: s.flyTo,
      setCableTypeToDraw: s.setCableTypeToDraw,
      cableTypeToDraw: s.cableTypeToDraw,
    })),
  );

  const select = useUiStore((s) => s.select);
  const setPanelOpen = useUiStore((s) => s.setPanelOpen);
  const setModalOpen = useUiStore((s) => s.setModalOpen);

  const [query, setQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('All');

  // Inline route save form
  const [isSavingRoute, setIsSavingRoute] = useState(false);
  const [saveRouteName, setSaveRouteName] = useState('');
  const [saveRouteNotes, setSaveRouteNotes] = useState('');

  // Survey configuration choices
  const [selectedPoleType, setSelectedPoleType] = useState<PoleTypeChoice>('Telecom Pole');
  const [selectedSplitRatio, setSelectedSplitRatio] = useState<SplitRatio>('1:8');
  const [selectedSlackLength, setSelectedSlackLength] = useState<SlackLength>(20);
  const [selectedFatPorts, setSelectedFatPorts] = useState<8 | 16>(8);

  const nextPole = useMemo(() => nextPoleName(equipments), [equipments]);
  const poleCount = useMemo(() => equipments.filter((e) => e.type.includes('Pole')).length, [equipments]);
  const isDrawingWire = activeTool === 'draw_cable';

  /**
   * Places equipment at the device's real GPS position and stores how accurate that was. If there is
   * no fix it saves nothing and says so; it never falls back to the map centre.
   */
  const dropEquipmentAtGps = async (type: EquipmentType, template: Partial<Equipment>) => {
    showToast('info', 'Getting your position', 'Stay still for a moment. This uses your GPS, not the map.');
    let fix;
    try {
      fix = await currentGpsPosition();
    } catch (error) {
      showToast('warning', 'Not placed: no GPS position', `${gpsFailureMessage(error)} Or use "Click Map to Plant".`);
      return;
    }
    const isPole = type.includes('Pole');
    const created = addEquipment({
      type,
      category:
        template.category ||
        (isPole || type === 'Fiber Slack Loop' ? 'Supporting Infrastructure' : 'Fiber Distribution'),
      totalPorts: template.totalPorts,
      availablePorts: template.totalPorts,
      notes: template.notes,
      ...template,
      name: isPole ? nextPoleName(useNetworkStore.getState().equipment) : template.name || `New ${type}`,
      lat: fix.lat,
      lng: fix.lng,
      locationMethod: 'gps',
      locationAccuracyMeters: fix.accuracyMeters,
    });
    if (created) {
      showToast(
        fix.accuracyMeters > 20 ? 'warning' : 'success',
        `${type} Added`,
        `${created.name} placed by GPS, within about ${Math.round(fix.accuracyMeters)} m.${fix.accuracyMeters > 20 ? ' That is rough: go to open sky, or move it later.' : ''}`,
      );
      select({ type: 'equipment', data: created });
      setPanelOpen('right', true);
    }
  };

  // Start Click-to-Place mode on Map
  const startPlacing = (type: EquipmentType, template: Partial<Equipment>) => {
    setActiveTool('add_equipment');
    setEquipmentTypeToAdd(type);
    setEquipmentDraftTemplate(template);
    showToast('info', `Click Map to Place ${template.name || type}`, 'Tap anywhere on the map to set coordinates.');
  };

  // Live GPS geolocation center
  const handleGpsCenter = () => {
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          flyTo(pos.coords.latitude, pos.coords.longitude, 18);
          showToast(
            'success',
            'GPS Locked',
            `Centered map on current location [${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}].`,
          );
        },
        () => {
          showToast('warning', 'GPS Unavailable', 'Falling back to current map coordinates.');
        },
        { enableHighAccuracy: true, timeout: 5000 },
      );
    } else {
      showToast('warning', 'No GPS here', `This device has no GPS. The map is centred at [${viewport.lat.toFixed(5)}, ${viewport.lng.toFixed(5)}], which is not your position.`);
    }
  };

  const handleSaveRouteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!saveRouteName.trim()) {
      showToast('warning', 'Route Name Required', 'Please enter a name for this GPS route.');
      return;
    }
    saveLiveRoute(saveRouteName, saveRouteNotes);
    setIsSavingRoute(false);
    setSaveRouteName('');
    setSaveRouteNotes('');
  };

  const allAssets = useMemo(() => {
    return [
      ...equipments.map((e) => ({
        id: e.id,
        name: e.name,
        type: e.type,
        category: e.category,
        lat: e.lat,
        lng: e.lng,
      })),
      ...faults
        .filter((f) => f.status !== 'Resolved')
        .map((f) => ({
          id: f.id,
          name: `[Outage] ${f.title}`,
          type: 'Fault Hazard',
          category: 'Faults',
          lat: f.affectedLocation.lat,
          lng: f.affectedLocation.lng,
        })),
      ...customers.map((c) => ({
        id: c.id,
        name: `${c.name} (${c.plan})`,
        type: 'Customer ONT',
        category: 'Customers',
        lat: c.lat,
        lng: c.lng,
      })),
    ];
  }, [equipments, faults, customers]);

  const nearby = useMemo(() => {
    const q = query.toLowerCase();
    return allAssets
      .filter((a) => {
        const matchesSearch =
          !q || a.id.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) || a.type.toLowerCase().includes(q);
        const matchesType =
          filterType === 'All' ||
          (filterType === 'OLT' && a.type === 'OLT') ||
          (filterType === 'FAT' && (a.type === 'FAT' || a.type.includes('Terminal Box'))) ||
          (filterType === 'Closures' && (a.type.includes('Closure') || a.type.includes('Splice'))) ||
          (filterType === 'Infrastructure' && (a.type.includes('Pole') || a.type.includes('Manhole'))) ||
          (filterType === 'Faults' && a.category === 'Faults') ||
          (filterType === 'Customers' && a.category === 'Customers');
        return matchesSearch && matchesType;
      })
      .slice(0, 16);
  }, [allAssets, query, filterType]);

  if (!isBikerMode) return null;

  return (
    <div className="absolute top-4 right-4 z-[450] w-96 max-w-[calc(100%-2rem)] bg-slate-900/95 backdrop-blur-md text-white rounded-2xl shadow-2xl border border-orange-500/40 overflow-hidden flex flex-col max-h-[88vh] animate-in fade-in slide-in-from-right-4 select-none">
      {/* High-Contrast Biker Field Ops Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-orange-600 via-amber-600 to-amber-700 text-white flex items-center justify-between shadow-md">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center backdrop-blur-xs ring-1 ring-white/30">
            <Bike className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="text-xs font-bold tracking-wide flex items-center gap-1.5">
              <span>Biker Mode: Live GPS & Survey</span>
              <span className="text-[9px] bg-white text-orange-700 px-1.5 py-0.2 rounded font-extrabold uppercase">
                Field Ops
              </span>
            </div>
            <div className="text-[10px] text-orange-100">Live GPS tracking & on-ground network mapping</div>
          </div>
        </div>

        <button
          onClick={() => {
            setIsBikerMode(false);
            clearBikerRoute();
          }}
          className="p-1.5 text-orange-100 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          title="Exit Biker Mode"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 3 Tabs: Field Survey, Live GPS Route, Turn-by-Turn Navigation */}
      <div className="flex border-b border-slate-800 bg-slate-950/60 p-1 gap-1 text-xs font-semibold">
        <button
          type="button"
          onClick={() => setActiveTab('survey')}
          className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1 transition-all ${
            activeTab === 'survey'
              ? 'bg-orange-500 text-white shadow-xs'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Wrench className="w-3.5 h-3.5 shrink-0" />
          <span>Survey</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('gps_track')}
          className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1 transition-all ${
            activeTab === 'gps_track'
              ? 'bg-orange-500 text-white shadow-xs'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Navigation className="w-3.5 h-3.5 shrink-0" />
          <span>GPS Track</span>
          {trackingStatus === 'recording' && (
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping ml-0.5" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('navigation')}
          className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1 transition-all ${
            activeTab === 'navigation'
              ? 'bg-orange-500 text-white shadow-xs'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Compass className="w-3.5 h-3.5 shrink-0" />
          <span>Road Nav</span>
        </button>
      </div>

      {/* Operator GPS & Viewport Bar */}
      <div className="px-3.5 py-2 bg-slate-950/80 border-b border-slate-800/80 flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-1.5 text-slate-300 font-mono">
          <MapPin className="w-3.5 h-3.5 text-orange-400 shrink-0" />
          <span>
            [{viewport.lat.toFixed(5)}, {viewport.lng.toFixed(5)}]
          </span>
          {equipmentTypeToAdd && (
            <span className="ml-1 text-[10px] font-sans font-semibold text-amber-300 bg-amber-500/20 px-1.5 py-0.2 rounded border border-amber-500/30 animate-pulse">
              Placing: {equipmentTypeToAdd}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleGpsCenter}
          className="px-2 py-0.5 rounded bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 border border-orange-500/30 flex items-center gap-1 text-[10px] font-medium transition-colors"
          title="Center on my device GPS"
        >
          <Crosshair className="w-3 h-3" />
          <span>Lock GPS</span>
        </button>
      </div>

      <div className="p-3.5 space-y-3.5 overflow-y-auto text-xs flex-1 text-slate-200">
        {/* ========================================================================= */}
        {/* TAB 1: FIELD SURVEY & EQUIPMENT PLACEMENT                                  */}
        {/* ========================================================================= */}
        {activeTab === 'survey' && (
          <>
            {/* 1. POLE MAPPING TOOL */}
            <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/80 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-slate-100">
                  <UtilityPole className="w-4 h-4 text-amber-400" />
                  <span>Map & Place Poles</span>
                </div>
                <span className="text-[10px] font-mono text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                  Next: {nextPole} ({poleCount} total)
                </span>
              </div>

              {/* Pole Type Toggle */}
              <div className="grid grid-cols-2 gap-1 bg-slate-900 p-0.5 rounded-lg text-[11px]">
                <button
                  type="button"
                  onClick={() => setSelectedPoleType('Telecom Pole')}
                  className={`py-1 rounded font-medium transition-colors ${
                    selectedPoleType === 'Telecom Pole' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Telecom Utility Pole
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedPoleType('Electric Pole')}
                  className={`py-1 rounded font-medium transition-colors ${
                    selectedPoleType === 'Electric Pole' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Shared Electric Pole
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() =>
                    startPlacing(selectedPoleType, {
                      name: nextPole,
                      category: 'Supporting Infrastructure',
                      notes: `${selectedPoleType} surveyed via Biker Field Navigation`,
                    })
                  }
                  className="py-1.5 px-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-medium flex items-center justify-center gap-1.5 transition-colors text-[11px]"
                >
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  <span>Click Map to Plant</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    void dropEquipmentAtGps(selectedPoleType, {
                      name: nextPole,
                      category: 'Supporting Infrastructure',
                      notes: `${selectedPoleType} placed by GPS`,
                    })
                  }
                  className="py-1.5 px-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium flex items-center justify-center gap-1.5 transition-colors text-[11px]"
                  title="Place a pole at your real GPS position"
                >
                  <Plus className="w-3.5 h-3.5 shrink-0" />
                  <span>Drop Pole Here</span>
                </button>
              </div>
            </div>

            {/* 2. DRAW WIRES / CABLES WITH IN-PAGE DELETE */}
            <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/80 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-slate-100">
                  <Route className="w-4 h-4 text-sky-400" />
                  <span>Draw Wires & Cables</span>
                </div>
                {isDrawingWire && (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 animate-pulse">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    {drawingPoints.length} points
                  </span>
                )}
              </div>

              {/* Cable Type Selector */}
              <div className="grid grid-cols-3 gap-1 bg-slate-900 p-0.5 rounded-lg text-[10px] font-medium">
                {(['Drop Fiber', 'Distribution Fiber', 'Main Feeder Fiber'] as CableType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setCableTypeToDraw(t)}
                    className={`py-1 px-1 rounded truncate transition-colors ${
                      cableTypeToDraw === t ? 'bg-sky-600 text-white font-bold' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {t.replace(' Fiber', '')}
                  </button>
                ))}
              </div>

              {!isDrawingWire ? (
                <button
                  type="button"
                  onClick={() => {
                    setActiveTool('draw_cable');
                    showToast(
                      'info',
                      'Draw Wires Active',
                      'Click consecutive poles or points on the map to draw fiber cable.',
                    );
                  }}
                  className="w-full py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold flex items-center justify-center gap-2 transition-colors text-xs shadow-xs"
                >
                  <Route className="w-4 h-4" />
                  <span>Start Drawing Wires (Pole to Pole)</span>
                </button>
              ) : (
                <div className="space-y-2 animate-in fade-in">
                  <div className="p-2 rounded-lg bg-sky-950/60 border border-sky-800/80 text-[11px] text-sky-200">
                    Click points on map to route wire. Press <strong>P</strong> while clicking to drop poles!
                  </div>

                  <div className="grid grid-cols-3 gap-1.5">
                    {/* Undo Point */}
                    <button
                      type="button"
                      onClick={() => setDrawingPoints((p) => p.slice(0, -1))}
                      disabled={drawingPoints.length === 0}
                      className="py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-200 font-medium flex items-center justify-center gap-1 text-[11px]"
                    >
                      <CornerUpLeft className="w-3.5 h-3.5" />
                      <span>Undo</span>
                    </button>

                    {/* Delete Drawn Wire Directly */}
                    <button
                      type="button"
                      onClick={() => {
                        setDrawingPoints([]);
                        setActiveTool('select');
                        showToast('info', 'Drawn Wire Deleted', 'Cleared all in-progress wire points.');
                      }}
                      className="py-1.5 rounded-lg bg-rose-600/30 hover:bg-rose-600/50 text-rose-300 border border-rose-500/40 font-medium flex items-center justify-center gap-1 text-[11px]"
                      title="Clear / delete the current wire"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete Wire</span>
                    </button>

                    {/* Finish Cable */}
                    <button
                      type="button"
                      onClick={() => {
                        if (drawingPoints.length < 2) {
                          showToast('warning', 'Route Incomplete', 'Click at least two points on the map.');
                          return;
                        }
                        setModalOpen('cableWizard', true);
                      }}
                      disabled={drawingPoints.length < 2}
                      className="py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-semibold flex items-center justify-center gap-1 text-[11px]"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Finish</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 3. SPLITTERS & PORT NUMBERS (1:4, 1:8, ETC.) */}
            <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/80 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-slate-100">
                  <Split className="w-4 h-4 text-purple-400" />
                  <span>Splitters & Port Numbers</span>
                </div>
                <span className="text-[10px] text-purple-300 font-mono">
                  {SPLIT_SPECS[selectedSplitRatio].ports} Ports · {SPLIT_SPECS[selectedSplitRatio].lossDb} dB
                </span>
              </div>

              {/* Port Ratio Pills */}
              <div className="grid grid-cols-3 gap-1.5">
                {(['1:2', '1:4', '1:8', '1:16', '1:32', 'ratio_90_10'] as SplitRatio[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setSelectedSplitRatio(r)}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-medium border text-center transition-all ${
                      selectedSplitRatio === r
                        ? 'bg-purple-600 border-purple-400 text-white shadow-xs'
                        : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {r === 'ratio_90_10' ? '90/10 Tap' : r}
                  </button>
                ))}
              </div>

              <div className="text-[10px] text-purple-200/80 bg-purple-950/40 p-1.5 rounded border border-purple-800/40">
                {SPLIT_SPECS[selectedSplitRatio].desc}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const spec = SPLIT_SPECS[selectedSplitRatio];
                    startPlacing('Outdoor Splitter', {
                      name: `PLC Splitter (${selectedSplitRatio})`,
                      totalPorts: spec.ports,
                      category: 'Fiber Distribution',
                      notes: `Split Ratio ${selectedSplitRatio}, ${spec.ports} Out-Ports, Insertion Loss ${spec.lossDb} dB`,
                    });
                  }}
                  className="py-1.5 px-2 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 font-medium flex items-center justify-center gap-1.5 transition-colors text-[11px]"
                >
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  <span>Click Map to Place</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const spec = SPLIT_SPECS[selectedSplitRatio];
                    void dropEquipmentAtGps('Outdoor Splitter', {
                      name: `PLC Splitter (${selectedSplitRatio})`,
                      totalPorts: spec.ports,
                      category: 'Fiber Distribution',
                      notes: `Split Ratio ${selectedSplitRatio}, ${spec.ports} Out-Ports, Insertion Loss ${spec.lossDb} dB`,
                    });
                  }}
                  className="py-1.5 px-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-medium flex items-center justify-center gap-1.5 transition-colors text-[11px]"
                >
                  <Plus className="w-3.5 h-3.5 shrink-0" />
                  <span>Drop Splitter Here</span>
                </button>
              </div>
            </div>

            {/* 4. FIBER SLACK LOOPS ("LOOPS ALSO") */}
            <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/80 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-slate-100">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <span>Fiber Slack Loops</span>
                </div>
                <span className="text-[10px] text-amber-300 font-mono">{selectedSlackLength}m Reserve Coil</span>
              </div>

              {/* Length Pills */}
              <div className="grid grid-cols-4 gap-1">
                {([10, 20, 30, 50] as SlackLength[]).map((len) => (
                  <button
                    key={len}
                    type="button"
                    onClick={() => setSelectedSlackLength(len)}
                    className={`py-1 rounded-lg text-[11px] font-medium border text-center transition-all ${
                      selectedSlackLength === len
                        ? 'bg-amber-600 border-amber-400 text-white shadow-xs'
                        : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {len}m
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() =>
                    startPlacing('Fiber Slack Loop', {
                      name: `Fiber Slack Loop (${selectedSlackLength}m)`,
                      category: 'Supporting Infrastructure',
                      notes: `${selectedSlackLength}m fiber cable coil reserve for maintenance / emergency restoration`,
                    })
                  }
                  className="py-1.5 px-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-medium flex items-center justify-center gap-1.5 transition-colors text-[11px]"
                >
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  <span>Click Map to Place</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    void dropEquipmentAtGps('Fiber Slack Loop', {
                      name: `Fiber Slack Loop (${selectedSlackLength}m)`,
                      category: 'Supporting Infrastructure',
                      notes: `${selectedSlackLength}m fiber cable coil reserve for maintenance / emergency restoration`,
                    })
                  }
                  className="py-1.5 px-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium flex items-center justify-center gap-1.5 transition-colors text-[11px]"
                >
                  <Plus className="w-3.5 h-3.5 shrink-0" />
                  <span>Drop Loop Here</span>
                </button>
              </div>
            </div>

            {/* 5. FAT / TERMINAL BOXES */}
            <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/80 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-slate-100">
                  <Layers className="w-4 h-4 text-emerald-400" />
                  <span>Distribution Box / FAT</span>
                </div>
                <div className="flex gap-1 text-[10px]">
                  {([8, 16] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setSelectedFatPorts(p)}
                      className={`px-2 py-0.5 rounded font-medium ${
                        selectedFatPorts === p ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-slate-400'
                      }`}
                    >
                      {p} Ports
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() =>
                    startPlacing('FAT', {
                      name: `Pole FAT (${selectedFatPorts} Ports)`,
                      totalPorts: selectedFatPorts,
                      category: 'Fiber Distribution',
                      notes: `Pole-mounted Fiber Access Terminal (${selectedFatPorts} subscriber drop ports)`,
                    })
                  }
                  className="py-1.5 px-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 font-medium flex items-center justify-center gap-1.5 transition-colors text-[11px]"
                >
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  <span>Click Map to Place</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    void dropEquipmentAtGps('FAT', {
                      name: `Pole FAT (${selectedFatPorts} Ports)`,
                      totalPorts: selectedFatPorts,
                      category: 'Fiber Distribution',
                      notes: `Pole-mounted Fiber Access Terminal (${selectedFatPorts} subscriber drop ports)`,
                    })
                  }
                  className="py-1.5 px-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium flex items-center justify-center gap-1.5 transition-colors text-[11px]"
                >
                  <Plus className="w-3.5 h-3.5 shrink-0" />
                  <span>Drop FAT Here</span>
                </button>
              </div>
            </div>
          </>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: MODULE 1 LIVE GPS TRACKING & ROUTE RECORDING                       */}
        {/* ========================================================================= */}
        {activeTab === 'gps_track' && (
          <div className="space-y-3 animate-in fade-in">
            {/* Live GPS Telemetry Card */}
            <div className="p-3 rounded-xl bg-slate-950/90 border border-orange-500/30 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-2.5 h-2.5 rounded-full ${
                      trackingStatus === 'recording'
                        ? 'bg-emerald-400 animate-ping'
                        : trackingStatus === 'paused'
                          ? 'bg-amber-400'
                          : 'bg-slate-500'
                    }`}
                  />
                  <span className="font-bold text-xs uppercase tracking-wide text-slate-100">
                    Live GPS Status:{' '}
                    <span
                      className={
                        trackingStatus === 'recording'
                          ? 'text-emerald-400'
                          : trackingStatus === 'paused'
                            ? 'text-amber-400'
                            : 'text-slate-400'
                      }
                    >
                      {trackingStatus.toUpperCase()}
                    </span>
                  </span>
                </div>

                <span className="text-[10px] font-mono bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded border border-orange-500/30">
                  Bike Mode
                </span>
              </div>

              {/* Live Metric Tiles */}
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                  <div className="text-[10px] text-slate-400 uppercase font-semibold">Total Distance</div>
                  <div className="text-lg font-bold text-sky-400 font-mono mt-0.5">{distanceKm.toFixed(3)} km</div>
                  <div className="text-[10px] text-slate-500">{Math.round(distanceKm * 1000)} metres</div>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                  <div className="text-[10px] text-slate-400 uppercase font-semibold">Elapsed Duration</div>
                  <div className="text-lg font-bold text-amber-400 font-mono mt-0.5 flex items-center justify-center gap-1">
                    <Clock className="w-4 h-4 shrink-0" />
                    <span>
                      {Math.floor(elapsedSeconds / 60)}m {elapsedSeconds % 60}s
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500">{trackedCoordinates.length} GPS points</div>
                </div>
              </div>

              {/* Accuracy & Coordinates Tile */}
              <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1.5 font-mono text-slate-300">
                  <MapPin className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                  <span>
                    {livePosition
                      ? `[${livePosition.lat.toFixed(6)}, ${livePosition.lng.toFixed(6)}]`
                      : `[${viewport.lat.toFixed(5)}, ${viewport.lng.toFixed(5)}]`}
                  </span>
                </div>

                <span
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-bold ${
                    gpsAccuracy !== null && gpsAccuracy <= 15
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : gpsAccuracy !== null && gpsAccuracy <= 35
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  ±{gpsAccuracy ? Math.round(gpsAccuracy) : '--'}m Accuracy
                </span>
              </div>

              {/* Error Notice */}
              {gpsError && (
                <div className="p-2 rounded-lg bg-rose-950/60 border border-rose-800/80 text-[11px] text-rose-200 flex items-start gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{gpsError}</span>
                </div>
              )}
            </div>

            {/* GPS Tracking Controls */}
            <div className="space-y-2">
              {trackingStatus === 'idle' && (
                <button
                  type="button"
                  onClick={startLiveTracking}
                  className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40 text-xs transition-all"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>Start Live GPS Tracking</span>
                </button>
              )}

              {trackingStatus === 'recording' && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={pauseLiveTracking}
                    className="py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold flex items-center justify-center gap-2 shadow-md text-xs transition-colors"
                  >
                    <Pause className="w-4 h-4 fill-current" />
                    <span>Pause</span>
                  </button>

                  <button
                    type="button"
                    onClick={stopLiveTracking}
                    className="py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold flex items-center justify-center gap-2 shadow-md text-xs transition-colors"
                  >
                    <Square className="w-4 h-4 fill-current" />
                    <span>Stop</span>
                  </button>
                </div>
              )}

              {trackingStatus === 'paused' && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={resumeLiveTracking}
                    className="py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center justify-center gap-2 shadow-md text-xs transition-colors"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>Resume</span>
                  </button>

                  <button
                    type="button"
                    onClick={stopLiveTracking}
                    className="py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold flex items-center justify-center gap-2 shadow-md text-xs transition-colors"
                  >
                    <Square className="w-4 h-4 fill-current" />
                    <span>Stop</span>
                  </button>
                </div>
              )}

              {/* Save & Reset Options (available when stopped or coordinates exist) */}
              {(trackingStatus === 'stopped' || trackedCoordinates.length >= 2) && !isSavingRoute && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setSaveRouteName(`Bike Route ${new Date().toLocaleDateString()}`);
                      setIsSavingRoute(true);
                    }}
                    className="py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold flex items-center justify-center gap-1.5 text-xs transition-colors shadow-md"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Save Route to DB</span>
                  </button>

                  <button
                    type="button"
                    onClick={clearLiveRoute}
                    className="py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold flex items-center justify-center gap-1.5 text-xs transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear Track</span>
                  </button>
                </div>
              )}

              {/* Inline Save Form */}
              {isSavingRoute && (
                <form
                  onSubmit={handleSaveRouteSubmit}
                  className="p-3 rounded-xl bg-slate-950 border border-blue-500/40 space-y-2 animate-in fade-in"
                >
                  <div className="text-xs font-bold text-blue-300">Save Completed Bike Route</div>
                  <input
                    type="text"
                    value={saveRouteName}
                    onChange={(e) => setSaveRouteName(e.target.value)}
                    placeholder="Route Name (e.g., Feeder Line Survey)"
                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white outline-none focus:border-blue-400"
                    autoFocus
                  />
                  <input
                    type="text"
                    value={saveRouteNotes}
                    onChange={(e) => setSaveRouteNotes(e.target.value)}
                    placeholder="Notes (optional, e.g. North ward road pole audit)"
                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-300 outline-none focus:border-blue-400"
                  />
                  <div className="flex gap-2 pt-1">
                    <button
                      type="submit"
                      className="flex-1 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs"
                    >
                      Save to Database
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsSavingRoute(false)}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs hover:bg-slate-700"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* View Previously Saved Routes Trigger */}
            <div className="pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setSavedRoutesModalOpen(true)}
                className="w-full py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 font-semibold flex items-center justify-between px-3 text-xs transition-colors border border-slate-700"
              >
                <div className="flex items-center gap-2">
                  <FolderOpen className="w-4 h-4 text-orange-400" />
                  <span>View Previously Saved Routes</span>
                </div>
                <span className="font-mono text-[10px] bg-slate-900 text-orange-300 px-2 py-0.5 rounded-full border border-slate-700">
                  {gpsRoutes.length} saved
                </span>
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: ROAD NAVIGATION                                                    */}
        {/* ========================================================================= */}
        {activeTab === 'navigation' && (
          <div className="space-y-3 animate-in fade-in">
            {/* Origin Spec */}
            <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between text-[11px]">
              <div>
                <span className="text-slate-400 font-semibold block text-[10px] uppercase">Departure Origin</span>
                <span className="font-bold text-slate-200">{bikerRoute?.originName ?? 'Your GPS location'}</span>
                {!bikerRoute && (
                  <span className="block text-[10px] text-slate-400">
                    If GPS is off: the selected item, then the map center
                  </span>
                )}
              </div>
              <span className="text-[10px] text-orange-400 font-mono bg-orange-500/10 px-2 py-0.5 rounded border border-orange-500/20">
                Starting Point
              </span>
            </div>

            {/* Search Input */}
            <div>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search destination OLT, FAT, Joint Closure, Customer..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 focus:border-orange-500 rounded-xl text-xs outline-none transition-all placeholder:text-slate-500 text-slate-100"
              />
            </div>

            {/* Filter Pills */}
            <div className="flex gap-1 overflow-x-auto pb-0.5 no-scrollbar text-[10px] font-semibold">
              {['All', 'OLT', 'FAT', 'Closures', 'Infrastructure', 'Faults', 'Customers'].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setFilterType(cat)}
                  className={`px-2 py-0.5 rounded-full transition-colors whitespace-nowrap ${
                    filterType === cat ? 'bg-orange-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Asset Selection List */}
            <div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                <span>Select Destination Asset</span>
                <span className="text-[10px] text-slate-500">Click to Route</span>
              </div>

              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-0.5">
                {nearby.map((asset) => (
                  <div key={asset.id} className="flex items-center gap-1.5 group">
                    <button
                      onClick={() => navigateToAsset(asset)}
                      className="flex-1 text-left p-2 rounded-xl border border-slate-800 hover:border-orange-500/60 bg-slate-950/60 hover:bg-orange-500/10 transition-all flex items-center justify-between"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[10px] font-bold text-orange-400 bg-orange-500/10 px-1.5 py-0.2 rounded border border-orange-500/20">
                            {asset.id}
                          </span>
                          <span className="font-semibold text-xs text-slate-200 truncate">{asset.name}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5 truncate">{asset.type}</div>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-orange-400 shrink-0" />
                    </button>

                    <button
                      title="Add as Intermediate Stop"
                      onClick={() => addBikerWaypoint(asset)}
                      className="p-2 rounded-xl border border-slate-800 hover:border-amber-400 hover:bg-amber-500/10 text-slate-400 hover:text-amber-300 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Multi-Stop Waypoints Strip */}
            {bikerWaypoints.length > 0 && (
              <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-[11px] space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Planned Stops
                </span>
                <div className="font-semibold text-slate-300 flex flex-wrap items-center gap-1">
                  <span className="text-orange-400">Start</span>
                  <span>&rarr;</span>
                  {bikerWaypoints.map((w, idx) => (
                    <React.Fragment key={w.id}>
                      <span className="bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700 text-slate-200 font-mono text-[10px]">
                        {w.id}
                      </span>
                      {idx < bikerWaypoints.length - 1 && <span>&rarr;</span>}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}

            {/* Active Route Telemetry & ETA */}
            {bikerRoute && (
              <div className="p-3 rounded-xl bg-orange-950/40 border border-orange-500/30 text-orange-100 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-sm text-orange-300">
                    <Navigation className="w-4 h-4 text-orange-400 animate-pulse" />
                    <span>{(bikerRoute.distanceMeters / 1000).toFixed(2)} km</span>
                  </div>
                  <div className="text-xs font-bold text-orange-300 bg-orange-500/20 px-2 py-0.5 rounded-md border border-orange-500/30">
                    ~{Math.max(1, Math.ceil(bikerRoute.durationSeconds / 60))} min ride
                  </div>
                </div>

                <div className="text-[10px] text-orange-200/80">
                  {bikerRoute.limitation || 'Road navigation route displayed in orange dashes on GIS map.'}
                </div>

                {/* Turn-by-Turn Steps */}
                {bikerRoute.steps && bikerRoute.steps.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-orange-500/20">
                    <div className="text-[10px] font-bold uppercase text-orange-300 mb-1">Turn-by-Turn</div>
                    <ol className="max-h-24 overflow-y-auto list-decimal pl-4 space-y-1 text-[11px] text-orange-100">
                      {bikerRoute.steps.map((st, i) => (
                        <li key={i} className="leading-tight">
                          {st}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            )}

            {bikerRoute && (
              <button
                type="button"
                onClick={clearBikerRoute}
                className="w-full py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl text-xs transition-colors"
              >
                Clear Road Route
              </button>
            )}
          </div>
        )}

        {/* Bottom Exit & Map Controls */}
        <div className="pt-2 border-t border-slate-800 flex gap-2">
          <button
            type="button"
            onClick={() => {
              setIsBikerMode(false);
              clearBikerRoute();
            }}
            className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5"
          >
            <span>Exit Biker Mode</span>
          </button>
        </div>
      </div>
    </div>
  );
};
