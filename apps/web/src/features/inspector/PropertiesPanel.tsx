import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bike,
  BookOpen,
  Camera,
  ChevronLeft,
  ChevronRight,
  Cpu,
  GitBranch,
  Grid,
  Layers,
  Radio,
  Sliders,
  Trash2,
  TrendingUp,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { simulatedOpticalPower } from '@fibergis/shared';

import { OltChassisIcon } from '../../components/icons/OltChassisIcon';
import { UtilityPoleIcon } from '../../components/icons/UtilityPoleIcon';
import { useBikerStore } from '../../stores/bikerStore';
import { useMapStore } from '../../stores/mapStore';
import { deleteCable, deleteEquipment, traceNetworkPath, updateEquipment } from '../../stores/networkActions';
import { useToastStore } from '../../stores/toastStore';
import { selectionLabel, useUiStore } from '../../stores/uiStore';

export const PropertiesPanel: React.FC = () => {
  const {
    selectedObject,
    setSelectedObject,
    isRightPanelOpen,
    setPanelOpen,
    setModalOpen,
    openKnowledgeForEquipment,
    uiMode,
  } = useUiStore(
    useShallow((s) => ({
      selectedObject: s.selectedObject,
      setSelectedObject: s.select,
      isRightPanelOpen: s.panels.right,
      setPanelOpen: s.setPanelOpen,
      setModalOpen: s.setModalOpen,
      openKnowledgeForEquipment: s.openKnowledge,
      uiMode: s.uiMode,
    })),
  );
  const { setIsBikerMode, navigateToAsset } = useBikerStore(
    useShallow((s) => ({ setIsBikerMode: s.setBikerMode, navigateToAsset: s.navigateTo })),
  );
  const showToast = useToastStore((s) => s.show);
  const { setSelectedCableTypeToDraw, setActiveDrawingPoints, setActiveTool, setSelectedEquipmentTypeToAdd } =
    useMapStore(
      useShallow((s) => ({
        setSelectedCableTypeToDraw: s.setCableTypeToDraw,
        setActiveDrawingPoints: s.setDrawingPoints,
        setActiveTool: s.setActiveTool,
        setSelectedEquipmentTypeToAdd: s.setEquipmentTypeToAdd,
      })),
    );

  const [selectedPonIndex, setSelectedPonIndex] = useState(0);
  const [showAdvancedSpecs, setShowAdvancedSpecs] = useState(false);

  if (!isRightPanelOpen) {
    return (
      <button
        onClick={() => setPanelOpen('right', true)}
        className="absolute top-20 right-0 z-20 bg-white/95 backdrop-blur-md border border-slate-200 border-r-0 rounded-l-xl p-2 shadow-md hover:bg-slate-50 transition-all text-slate-600"
        title="Open Properties Inspector"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
    );
  }

  if (!selectedObject) {
    return (
      <div className="w-80 bg-white/95 backdrop-blur-md border-l border-slate-200/80 flex flex-col z-20 shrink-0 select-none shadow-md p-6 text-center justify-center items-center text-slate-400">
        <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
          <Layers className="w-6 h-6" />
        </div>
        <div className="font-semibold text-xs text-slate-700 mb-1">No Object Selected</div>
        <p className="text-[11px] leading-relaxed max-w-xs">
          Click any equipment marker, cable route, customer pin, or fault hazard on the map to inspect properties and
          fiber connections.
        </p>
      </div>
    );
  }

  const { type, data } = selectedObject;

  const getFriendlyDetails = () => {
    if (type === 'equipment') {
      switch (data.type) {
        case 'OLT':
          return {
            title: 'Main Internet Hub',
            emoji: '🏢',
            badge: 'Central Hub',
            desc: 'Main station sending high-speed fiber internet to the whole city.',
            signalLevel: '98% (Excellent Master Signal)',
          };
        case 'FAT':
          return {
            title: 'Street Customer Box',
            emoji: '📦',
            badge: 'Neighborhood Box',
            desc: 'Box on pole or wall where customer home wires plug in.',
            signalLevel: '95% (Strong Local Signal)',
          };
        case 'FDT':
          return {
            title: 'Main Street Distribution Box',
            emoji: '📦',
            badge: 'Area Distribution',
            desc: 'Connects main feeder cables into local street cables.',
            signalLevel: '96% (Strong Distribution Signal)',
          };
        case 'FDMS':
          return {
            title: 'Central Fiber Cabinet',
            emoji: '🏢',
            badge: 'Street Cabinet',
            desc: 'Primary street cabinet splitting fiber routes.',
            signalLevel: '97% (Strong Feeder Signal)',
          };
        case 'Fiber Splitter':
          return {
            title: 'Optical Signal Splitter',
            emoji: '🔀',
            badge: 'Signal Splitter',
            desc: 'Splits 1 incoming fiber line to 8 or 16 customer houses.',
            signalLevel: '94% (Good Optical Level)',
          };
        case 'Fiber Joint Closure':
          return {
            title: 'Cable Joint Box',
            emoji: '🧰',
            badge: 'Splice Enclosure',
            desc: 'Weatherproof box where fiber wires are joined together.',
            signalLevel: '95% (Normal Connection)',
          };
        case 'Telecom Pole':
        case 'Electric Pole':
          return {
            title: 'Utility Pole',
            emoji: '⚡',
            badge: 'Aerial Pole',
            desc: 'Carries overhead fiber wires along roads.',
            signalLevel: 'Aerial Route Support',
          };
        case 'Manhole':
        case 'Handhole':
          return {
            title: 'Underground Chamber',
            emoji: '🕳️',
            badge: 'Underground Manhole',
            desc: 'Protects underground fiber cables under the road.',
            signalLevel: 'Subsurface Cable Route',
          };
        default:
          return {
            title: data.name || data.type,
            emoji: '📦',
            badge: data.type,
            desc: data.category || 'Network Equipment',
            signalLevel: 'Normal',
          };
      }
    }
    return { title: selectionLabel(selectedObject), emoji: '📍', badge: type, desc: '', signalLevel: 'Normal' };
  };

  const friendly = getFriendlyDetails();
  const status = 'status' in data ? data.status : undefined;
  const address = 'street' in data ? `${data.street}, ${data.area}` : 'area' in data ? data.area : '';

  return (
    <div className="w-84 sm:w-88 bg-white/95 backdrop-blur-md border-l border-slate-200/80 flex flex-col z-20 shrink-0 select-none shadow-md transition-all duration-200 overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
        <div className="flex items-center gap-2">
          {uiMode === 'simple' ? (
            <span className="text-base">{friendly.emoji}</span>
          ) : (
            <>
              {type === 'equipment' && <Cpu className="w-4 h-4 text-blue-600" />}
              {type === 'cable' && <GitBranch className="w-4 h-4 text-cyan-600" />}
              {type === 'customer' && <Users className="w-4 h-4 text-emerald-600" />}
              {type === 'fault' && <AlertTriangle className="w-4 h-4 text-rose-600" />}
            </>
          )}
          <span className="font-bold text-xs text-slate-800 uppercase tracking-wide">
            {uiMode === 'simple' ? `${friendly.title} Inspector` : `${type} Inspector`}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {type === 'cable' && (
            <button
              onClick={() => {
                deleteCable(data.id);
                setSelectedObject(null);
                showToast('success', 'Wire Route Deleted', `Deleted cable ${data.name || data.id}`);
              }}
              title="Delete this wire route from network"
              className="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-md text-[11px] font-bold flex items-center gap-1 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-600" />
              <span>Delete Wire</span>
            </button>
          )}
          {type === 'equipment' && (
            <button
              onClick={() => openKnowledgeForEquipment(data.type)}
              title="Learn what this equipment is, how it works, and FTTH rules"
              className="p-1 rounded-md text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-[11px] font-bold flex items-center gap-1 transition-colors"
            >
              <BookOpen className="w-3.5 h-3.5 text-indigo-600" />
              <span className="hidden sm:inline">Learn Equipment</span>
            </button>
          )}
          <button
            onClick={() => setSelectedObject(null)}
            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
            title="Deselect"
          >
            <X className="w-4 h-4" />
          </button>
          <button
            onClick={() => setPanelOpen('right', false)}
            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
            title="Collapse Panel"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Body Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
        {/* Title & Badge */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="font-mono text-[11px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200/60">
              {data.id}
            </span>
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                status === 'Active' || status === 'Resolved'
                  ? 'bg-emerald-100 text-emerald-700'
                  : status === 'Faulty'
                    ? 'bg-rose-100 text-rose-700 animate-pulse'
                    : 'bg-amber-100 text-amber-700'
              }`}
            >
              {uiMode === 'simple'
                ? status === 'Active'
                  ? '🟢 Working Great'
                  : status === 'Faulty'
                    ? '🔴 Needs Repair'
                    : `🟡 ${status || 'Active'}`
                : status || 'Active'}
            </span>
          </div>
          <h3 className="font-bold text-sm text-slate-900 leading-snug">
            {uiMode === 'simple' && type === 'equipment'
              ? `${friendly.title} (${data.name || data.id})`
              : selectionLabel(selectedObject)}
          </h3>
          {address && <p className="text-[11px] text-slate-500">{address}</p>}
        </div>

        {/* EQUIPMENT DETAILS */}
        {type === 'equipment' && (
          <>
            {uiMode === 'simple' ? (
              /* --- SIMPLE MODE VIEW FOR FIELD WORKERS & NON-TECHNICAL USERS --- */
              <div className="space-y-3">
                {/* 1. What is this box? Explanation */}
                <div className="bg-blue-50/70 border border-blue-100 rounded-xl p-3 text-xs text-blue-900 flex items-start gap-2.5">
                  {data.type === 'OLT' ? (
                    <OltChassisIcon width={44} height={23} status={data.status} className="shrink-0 mt-0.5" />
                  ) : data.type.includes('Pole') ? (
                    <UtilityPoleIcon width={24} height={32} status={data.status} className="shrink-0 mt-0.5" />
                  ) : (
                    <span className="text-xl shrink-0 mt-0.5">{friendly.emoji}</span>
                  )}
                  <div>
                    <div className="font-bold text-[12px]">{friendly.title}</div>
                    <p className="text-[11px] text-blue-800 leading-relaxed mt-0.5">{friendly.desc}</p>
                  </div>
                </div>

                {/* Utility Pole Hardware Preview */}
                {data.type.includes('Pole') && (
                  <div className="bg-gradient-to-b from-sky-50 to-amber-50/40 p-3 rounded-xl border border-amber-200/70 flex flex-col items-center justify-center gap-1.5 shadow-2xs">
                    <UtilityPoleIcon width={55} height={68} status={data.status} isSelected={true} />
                    <span className="text-[10px] text-slate-600 font-semibold tracking-wider text-center">
                      Wooden Aerial Utility Pole (T-Crossarm with Ceramic Insulators)
                    </span>
                  </div>
                )}

                {/* OLT Rack Chassis Hardware Preview (Matches Authentic Hardware) */}
                {data.type === 'OLT' && (
                  <>
                    <div className="bg-slate-900/95 p-3 rounded-xl border border-slate-800 flex flex-col items-center justify-center gap-1.5 shadow-inner">
                      <OltChassisIcon
                        width={160}
                        height={82}
                        status={data.status}
                        isSelected={true}
                        technology={data.technology || 'GPON'}
                      />
                      <span className="text-[10px] text-slate-400 font-mono tracking-wider">
                        {data.model || 'Huawei SmartAX MA5800-X7 OLT'}
                      </span>
                    </div>

                    {/* OLT Technology Selector (GPON / EPON) */}
                    <div className="bg-white rounded-xl p-2.5 border border-blue-200/80 space-y-2">
                      <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                        <span>PON Technology Standard:</span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${
                            (data.technology || 'GPON') === 'EPON'
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-blue-100 text-blue-700'
                          }`}
                        >
                          {data.technology || 'GPON'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            updateEquipment({ ...data, technology: 'GPON' });
                            showToast('success', 'Set as GPON OLT', `${data.name} updated to GPON (ITU-T G.984).`);
                          }}
                          className={`py-1.5 px-2 rounded-lg text-xs font-bold border transition-all ${
                            (data.technology || 'GPON') === 'GPON'
                              ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                              : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-blue-50'
                          }`}
                        >
                          🔵 GPON
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            updateEquipment({ ...data, technology: 'EPON' });
                            showToast('success', 'Set as EPON OLT', `${data.name} updated to EPON (IEEE 802.3ah).`);
                          }}
                          className={`py-1.5 px-2 rounded-lg text-xs font-bold border transition-all ${
                            data.technology === 'EPON'
                              ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                              : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-purple-50'
                          }`}
                        >
                          🟣 EPON
                        </button>
                      </div>
                    </div>

                    {/* OLT Quick Connect Buttons */}
                    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200/90 rounded-xl p-3 space-y-2 shadow-xs">
                      <div className="text-[11px] font-extrabold text-blue-900 flex items-center gap-1.5 uppercase tracking-wide">
                        <Zap className="w-3.5 h-3.5 text-blue-600 fill-blue-600" />
                        <span>Quick Connect from this OLT:</span>
                      </div>

                      <div className="space-y-1.5">
                        <button
                          onClick={() => {
                            setSelectedCableTypeToDraw('Main Feeder Fiber');
                            setActiveDrawingPoints([[data.lat, data.lng]]);
                            setActiveTool('draw_cable');
                            showToast(
                              'info',
                              'Drawing Feeder Wire',
                              `Started wire from ${data.name}. Click along the street or poles!`,
                            );
                          }}
                          className="w-full py-2.5 px-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-sm transition-all active:scale-98"
                        >
                          <Activity className="w-4 h-4 shrink-0" />
                          <span>⚡ Draw Wire from this OLT</span>
                        </button>

                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            onClick={() => {
                              setSelectedEquipmentTypeToAdd('Telecom Pole');
                              setActiveTool('add_equipment');
                              showToast(
                                'info',
                                'Place Utility Pole',
                                'Click on the map near the road to place a utility pole.',
                              );
                            }}
                            className="py-2 px-2 bg-white hover:bg-amber-50 text-slate-800 hover:text-amber-900 border border-slate-200 hover:border-amber-300 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
                          >
                            <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                            <span>+ Place Pole</span>
                          </button>

                          <button
                            onClick={() => {
                              setSelectedEquipmentTypeToAdd('FAT');
                              setActiveTool('add_equipment');
                              showToast(
                                'info',
                                'Place Street Box (FAT)',
                                'Click on the map to place a customer distribution box.',
                              );
                            }}
                            className="py-2 px-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-300 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
                          >
                            <span className="font-bold">📦</span>
                            <span>+ Add FAT Box</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* 2. Signal Quality (Simple 95% Excellent display) */}
                <div className="bg-emerald-50 border border-emerald-200/80 rounded-xl p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                      <Radio className="w-3.5 h-3.5 text-emerald-600" /> Signal Quality
                    </span>
                    <span className="text-[11px] font-extrabold text-emerald-700 bg-white px-2 py-0.5 rounded-full border border-emerald-300">
                      EXCELLENT 95%
                    </span>
                  </div>
                  <div className="w-full h-2 bg-emerald-200 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-600 rounded-full" style={{ width: '95%' }}></div>
                  </div>
                  <p className="text-[10px] text-emerald-800">
                    Strong and steady optical light signal from the central hub.
                  </p>
                </div>

                {/* 3. Port & Plug Availability */}
                {(() => {
                  const used = data.usedPorts || (data.type === 'OLT' ? 12 : data.type === 'FAT' ? 6 : 4);
                  const total = data.totalPorts || (data.type === 'OLT' ? 16 : data.type === 'FAT' ? 8 : 8);
                  const free = Math.max(0, total - used);

                  return (
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                        <span className="flex items-center gap-1.5">
                          <Grid className="w-3.5 h-3.5 text-blue-600" /> Plug Sockets (Ports)
                        </span>
                        <span className="text-blue-600 font-mono text-[11px]">
                          {used} / {total} Plugged In
                        </span>
                      </div>

                      {/* Visual Port Blocks */}
                      <div className="flex gap-1 flex-wrap pt-0.5">
                        {Array.from({ length: total }).map((_, idx) => (
                          <div
                            key={idx}
                            title={
                              idx < used
                                ? `Plug #${idx + 1}: In Use by Home`
                                : `Plug #${idx + 1}: Free to connect new home`
                            }
                            className={`w-4 h-4 rounded-md flex items-center justify-center text-[9px] font-bold ${
                              idx < used
                                ? 'bg-emerald-500 text-white'
                                : 'bg-blue-100 text-blue-700 border border-blue-300'
                            }`}
                          >
                            {idx + 1}
                          </div>
                        ))}
                      </div>

                      <div className="text-[11px] text-slate-600 bg-white p-2 rounded-lg border border-slate-200/80 space-y-1">
                        <div className="flex justify-between font-medium">
                          <span>🏠 Connected Houses:</span>
                          <span className="font-bold text-emerald-700">{used} Online</span>
                        </div>
                        <div className="flex justify-between font-medium">
                          <span>🔌 Free Sockets Available:</span>
                          <span className="font-bold text-blue-700">{free} Free</span>
                        </div>
                        <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-100 font-normal">
                          👉 You can plug <strong className="text-slate-800">{free} more customer homes</strong> into
                          this box right now.
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* 4. Big Action Buttons for Simple Mode */}
                <div className="space-y-2 pt-1">
                  <button
                    onClick={() => {
                      navigateToAsset({ id: data.id, name: data.name, lat: data.lat, lng: data.lng, type: data.type });
                      setIsBikerMode(true);
                    }}
                    className="w-full py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white rounded-xl text-xs font-bold shadow-md shadow-orange-500/20 flex items-center justify-center gap-2 transition-all active:scale-98"
                  >
                    <Bike className="w-4 h-4" />
                    <span>Take Me Here (Bike GPS Directions)</span>
                  </button>

                  <button
                    onClick={() => setModalOpen('portManager', true)}
                    className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-sm flex items-center justify-center gap-2 transition-all"
                  >
                    <Grid className="w-3.5 h-3.5" />
                    <span>Check Free & Used Sockets (Grid)</span>
                  </button>

                  <button
                    onClick={() => traceNetworkPath(data.id)}
                    className="w-full py-2 bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors"
                  >
                    <Activity className="w-3.5 h-3.5 text-sky-600" />
                    <span>Follow Wire Route to Main Hub</span>
                  </button>

                  {(data.type === 'FAT' || data.type.includes('Terminal Box')) && (
                    <button
                      onClick={() => setModalOpen('terminalBox', true)}
                      className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
                    >
                      <Camera className="w-3.5 h-3.5 text-slate-600" />
                      <span>View Box Photographs</span>
                    </button>
                  )}
                </div>

                {/* 5. Expandable Accordion for Advanced Telecom Technical Specs */}
                <div className="pt-2 border-t border-slate-100">
                  <button
                    onClick={() => setShowAdvancedSpecs(!showAdvancedSpecs)}
                    className="w-full py-1.5 px-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-[11px] font-semibold text-slate-700 flex items-center justify-between transition-colors"
                  >
                    <span>🔧 Advanced Telecom Specs (dBm, IP, SFP)</span>
                    <span>{showAdvancedSpecs ? '▲ Hide' : '▼ Show'}</span>
                  </button>

                  {showAdvancedSpecs && (
                    <div className="mt-2 space-y-2 animate-in fade-in slide-in-from-top-1 text-xs">
                      <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 space-y-1.5">
                        <div className="flex justify-between">
                          <span className="text-slate-500">Hardware:</span>{' '}
                          <span className="font-semibold">
                            {data.manufacturer} {data.model}
                          </span>
                        </div>
                        {data.ipAddress && (
                          <div className="flex justify-between">
                            <span className="text-slate-500">IP Address:</span>{' '}
                            <span className="font-mono text-blue-600 font-bold">{data.ipAddress}</span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-slate-500">Category:</span> <span>{data.category}</span>
                        </div>
                      </div>

                      {data.type === 'OLT' && (
                        <div className="bg-slate-900 text-white p-3 rounded-lg space-y-2">
                          <div className="text-[10px] text-amber-400 uppercase font-bold">Simulated Optical Power</div>
                          <div className="grid grid-cols-2 gap-2 text-center">
                            <div className="bg-slate-800 p-1.5 rounded">
                              <span className="text-[10px] text-slate-400 block">Tx Power</span>
                              <span className="font-mono font-bold text-sky-400">+3.2 dBm</span>
                            </div>
                            <div className="bg-slate-800 p-1.5 rounded">
                              <span className="text-[10px] text-slate-400 block">Rx Power</span>
                              <span className="font-mono font-bold text-emerald-400">-18.6 dBm</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Delete button */}
                <button
                  onClick={() => deleteEquipment(data.id)}
                  className="w-full py-1 text-rose-500 hover:bg-rose-50 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Delete This Box</span>
                </button>
              </div>
            ) : (
              /* --- PRO MODE VIEW FOR NETWORK ENGINEERS --- */
              <>
                {/* Quick Specs */}
                <div className="bg-slate-50 rounded-xl p-3 border border-slate-200/70 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Category:</span>
                    <span className="font-semibold text-slate-800">{data.category}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Type:</span>
                    <span className="font-semibold text-slate-800">{data.type}</span>
                  </div>
                  {data.manufacturer && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Hardware:</span>
                      <span className="font-semibold text-slate-800">
                        {data.manufacturer} {data.model}
                      </span>
                    </div>
                  )}
                  {data.ipAddress && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Management IP:</span>
                      <span className="font-mono font-semibold text-blue-600">{data.ipAddress}</span>
                    </div>
                  )}
                  {data.totalPorts && (
                    <div>
                      <div className="flex justify-between mb-1 text-[11px]">
                        <span className="text-slate-500">Port Utilization:</span>
                        <span className="font-bold text-slate-700">
                          {data.usedPorts || 0} / {data.totalPorts} Used (
                          {Math.round(((data.usedPorts || 0) / data.totalPorts) * 100)}%)
                        </span>
                      </div>
                      <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden flex">
                        <div
                          className="bg-blue-600 h-full"
                          style={{ width: `${((data.usedPorts || 0) / data.totalPorts) * 100}%` }}
                        ></div>
                      </div>
                    </div>
                  )}
                </div>

                {/* OLT Rack Chassis Hardware Preview (Matches Authentic Hardware) */}
                {data.type === 'OLT' && (
                  <div className="bg-slate-900 rounded-xl p-3 border border-slate-800 flex flex-col items-center justify-center gap-1.5 shadow-md">
                    <OltChassisIcon width={170} height={88} status={data.status} isSelected={true} />
                    <div className="text-[10px] text-slate-400 font-mono flex items-center gap-2">
                      <span>19" Rack Chassis</span>
                      <span>&bull;</span>
                      <span>{data.technology || 'GPON'} (16 PON Ports)</span>
                    </div>
                  </div>
                )}

                {/* OLT PON Technology Configuration (GPON / EPON / Combo PON) */}
                {data.type === 'OLT' && (
                  <div className="bg-blue-50/70 border border-blue-200/90 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold text-blue-900">
                      <span className="flex items-center gap-1.5">
                        <Cpu className="w-4 h-4 text-blue-600" />
                        <span>PON Technology Standard</span>
                      </span>
                      <span className="text-[10px] bg-blue-600 text-white font-bold px-2 py-0.5 rounded-full">
                        {data.technology || 'GPON'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <label className="text-[11px] font-semibold text-slate-600 shrink-0">Standard:</label>
                      <select
                        value={data.technology || 'GPON'}
                        onChange={(e) => {
                          const tech = e.target.value as any;
                          updateEquipment({ ...data, technology: tech });
                          showToast('success', 'OLT Technology Configured', `${data.name} updated to ${tech}`);
                        }}
                        className="flex-1 bg-white border border-blue-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-900 outline-none focus:ring-2 focus:ring-blue-400"
                      >
                        <option value="GPON">GPON (ITU-T G.984 - 2.5G/1.25G)</option>
                        <option value="EPON">EPON (IEEE 802.3ah - 1.25G/1.25G)</option>
                        <option value="Combo PON">Combo PON (GPON + XGS-PON)</option>
                        <option value="XGS-PON">XGS-PON (ITU-T G.9807 - 10G/10G)</option>
                        <option value="10G-EPON">10G-EPON (IEEE 802.3av)</option>
                      </select>
                    </div>

                    <div className="text-[10px] text-slate-600 bg-white/80 p-2 rounded-lg border border-blue-100 space-y-1">
                      {(data.technology || 'GPON') === 'GPON' ? (
                        <>
                          <div className="font-bold text-blue-900">ITU-T G.984 Gigabit PON</div>
                          <div>&bull; Downstream: 2.488 Gbps | Upstream: 1.244 Gbps</div>
                          <div>&bull; Max Optical Split: 1:128 (Typically 1:64)</div>
                          <div>&bull; Wavelengths: 1490nm Tx / 1310nm Rx</div>
                        </>
                      ) : (data.technology || 'GPON') === 'EPON' ? (
                        <>
                          <div className="font-bold text-indigo-900">IEEE 802.3ah Ethernet PON</div>
                          <div>&bull; Symmetric 1.25 Gbps Down / 1.25 Gbps Up</div>
                          <div>&bull; Max Optical Split: 1:64 (Typically 1:32)</div>
                          <div>&bull; Native Ethernet 802.3 frames</div>
                        </>
                      ) : (
                        <>
                          <div className="font-bold text-purple-900">Next-Gen 10-Gigabit PON</div>
                          <div>&bull; 9.953 Gbps Symmetric line rate</div>
                          <div>&bull; Co-exists with legacy GPON via WDM</div>
                        </>
                      )}
                    </div>

                    <button
                      onClick={() => setModalOpen('portManager', true)}
                      className="w-full py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
                    >
                      <Grid className="w-3.5 h-3.5" />
                      <span>Configure PON Cards & Ports (0/1/1)</span>
                    </button>
                  </div>
                )}

                {/* OLT Optical Power Telemetry & PON Port Management */}
                {data.type === 'OLT' && (
                  <div className="space-y-3">
                    {(() => {
                      const optical = simulatedOpticalPower(data);
                      const activePon = data.ponPorts?.[selectedPonIndex] || data.ponPorts?.[0];
                      const txVal = activePon?.txPowerDbm ?? optical.txPowerDbm ?? 3.2;
                      const rxVal = activePon?.rxPowerDbm ?? optical.rxPowerDbm ?? -18.6;
                      const isWarning = rxVal <= -24;
                      const isCritical = rxVal <= -27;
                      const statusLabel = isCritical ? 'Critical' : isWarning ? 'Warning' : 'Normal';
                      const statusBg = isCritical ? 'bg-rose-500' : isWarning ? 'bg-amber-400' : 'bg-emerald-500';

                      return (
                        <div className="bg-slate-900 text-white rounded-xl p-3.5 space-y-3 shadow-md border border-slate-800">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <Radio className="w-3.5 h-3.5 text-sky-400" />
                              <span className="font-bold text-xs tracking-wide">Optical Power Telemetry</span>
                            </div>
                            <span className="text-[9px] font-bold tracking-wider uppercase bg-amber-500/20 text-amber-300 border border-amber-500/40 px-1.5 py-0.5 rounded">
                              Simulated Sample
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-[11px] bg-slate-800/80 p-2 rounded-lg border border-slate-700/60">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`w-2.5 h-2.5 rounded-full ${statusBg} ${isCritical ? 'animate-ping' : ''}`}
                              />
                              <span className="font-semibold">{statusLabel} Power Level</span>
                            </div>
                            <span className="text-[10px] text-slate-400 font-mono">{optical.lastUpdated}</span>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-center">
                            <div className="p-2.5 bg-slate-800 rounded-lg border border-slate-700">
                              <span className="text-[10px] text-slate-400 uppercase font-semibold block">Tx Power</span>
                              <span className="font-mono text-sm font-bold text-sky-400">+{txVal.toFixed(1)} dBm</span>
                              <span className="text-[9px] text-slate-400 block mt-0.5">Threshold: 1.5 ~ 5.0 dBm</span>
                            </div>
                            <div className="p-2.5 bg-slate-800 rounded-lg border border-slate-700">
                              <span className="text-[10px] text-slate-400 uppercase font-semibold block">Rx Power</span>
                              <span
                                className={`font-mono text-sm font-bold ${isCritical ? 'text-rose-400' : isWarning ? 'text-amber-400' : 'text-emerald-400'}`}
                              >
                                {rxVal.toFixed(1)} dBm
                              </span>
                              <span className="text-[9px] text-slate-400 block mt-0.5">Warn: -24 | Crit: -27</span>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-[10px] text-slate-400 font-semibold">
                              <span className="flex items-center gap-1">
                                <TrendingUp className="w-3 h-3 text-emerald-400" /> 12-Hour Power Trend
                              </span>
                              <span className="text-[9px] text-slate-500">Hourly Samples</span>
                            </div>
                            <div className="h-16 bg-slate-950 rounded-lg p-1.5 relative border border-slate-800/80 flex items-center justify-center">
                              <svg className="w-full h-full" viewBox="0 0 240 50">
                                <line
                                  x1="0"
                                  y1="36"
                                  x2="240"
                                  y2="36"
                                  stroke="#f59e0b"
                                  strokeWidth="1"
                                  strokeDasharray="3,3"
                                  opacity="0.6"
                                />
                                <line
                                  x1="0"
                                  y1="44"
                                  x2="240"
                                  y2="44"
                                  stroke="#ef4444"
                                  strokeWidth="1"
                                  strokeDasharray="3,3"
                                  opacity="0.6"
                                />
                                <polyline
                                  fill="none"
                                  stroke="#10b981"
                                  strokeWidth="2"
                                  points="0,24 20,22 40,26 60,24 80,25 100,23 120,28 140,25 160,26 180,24 200,25 220,23 240,24"
                                />
                                <polyline
                                  fill="none"
                                  stroke="#38bdf8"
                                  strokeWidth="1.5"
                                  points="0,10 20,11 40,9 60,10 80,11 100,9 120,10 140,11 160,10 180,9 200,10 220,11 240,10"
                                />
                              </svg>
                            </div>
                            <div className="flex items-center justify-between text-[9px] text-slate-400 px-1">
                              <span className="flex items-center gap-1">
                                <span className="w-2 h-0.5 bg-sky-400" /> Tx Signal (+3.2)
                              </span>
                              <span className="flex items-center gap-1">
                                <span className="w-2 h-0.5 bg-emerald-400" /> Rx Signal (-18.6)
                              </span>
                              <span className="flex items-center gap-1">
                                <span className="w-2 h-0.5 bg-amber-400" /> Threshold
                              </span>
                            </div>
                          </div>

                          {/* PON Port Selector Tabs */}
                          <div>
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                              <span>Select PON Port</span>
                              <span className="text-[10px] text-sky-400 font-mono">
                                Port {activePon?.id || 'PON-01'}
                              </span>
                            </div>
                            <div className="grid grid-cols-4 gap-1">
                              {data.ponPorts?.map((pon: any, idx: number) => {
                                const isSel = selectedPonIndex === idx;
                                return (
                                  <button
                                    key={pon.id}
                                    type="button"
                                    onClick={() => setSelectedPonIndex(idx)}
                                    className={`p-1.5 rounded text-center transition-all ${
                                      isSel
                                        ? 'bg-sky-600 text-white font-bold ring-1 ring-sky-300'
                                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                                    }`}
                                  >
                                    <div className="font-mono text-[10px] font-bold">{pon.id}</div>
                                    <div className="text-[8px] opacity-80">{pon.connectedCustomersCount || 0} subs</div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* Photos & Terminal Box Inspection Callout */}
                {(data.type === 'FAT' || data.type.includes('Terminal Box')) && (
                  <div className="bg-blue-50/70 rounded-xl p-3 border border-blue-200">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-xs text-blue-900 flex items-center gap-1.5">
                        <Camera className="w-3.5 h-3.5 text-blue-600" /> Field Photographs
                      </span>
                      <span className="text-[10px] font-semibold text-blue-700 bg-blue-100 px-1.5 py-0.2 rounded">
                        {data.images?.length || 0} uploaded
                      </span>
                    </div>
                    <p className="text-[11px] text-blue-800 mb-2.5">
                      Inspect high-resolution terminal photographs and interactive port annotations.
                    </p>
                    <button
                      onClick={() => setModalOpen('terminalBox', true)}
                      className="w-full py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-xs flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>Open Box & Photo Annotator</span>
                    </button>
                  </div>
                )}

                {/* Joint Closure Splice Callout */}
                {(data.type.includes('Joint Closure') || data.type.includes('Splice')) && (
                  <div className="bg-amber-50/80 rounded-xl p-3 border border-amber-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs text-amber-900 flex items-center gap-1.5">
                        <GitBranch className="w-3.5 h-3.5 text-amber-600" /> Fusion Splicing Trays
                      </span>
                    </div>
                    <p className="text-[11px] text-amber-800">
                      Manage core-to-core optical fusion splices and splice tray mappings.
                    </p>
                    <button
                      onClick={() => setModalOpen('splicing', true)}
                      className="w-full py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold shadow-xs flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <GitBranch className="w-3.5 h-3.5" />
                      <span>Open Splicing Matrix</span>
                    </button>
                  </div>
                )}

                {/* Splitter Port Callout */}
                {data.type.includes('Splitter') && (
                  <div className="bg-purple-50/80 rounded-xl p-3 border border-purple-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs text-purple-900 flex items-center gap-1.5">
                        <Sliders className="w-3.5 h-3.5 text-purple-600" /> Splitter Ports
                      </span>
                    </div>
                    <p className="text-[11px] text-purple-800">
                      Manage input feeder and output distribution drop ports.
                    </p>
                    <button
                      onClick={() => setModalOpen('splitter', true)}
                      className="w-full py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold shadow-xs flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Sliders className="w-3.5 h-3.5" />
                      <span>Open Splitter Ports</span>
                    </button>
                  </div>
                )}

                {/* Actions for All Equipment */}
                <div className="pt-2 border-t border-slate-100 space-y-2">
                  {(data.totalPorts ||
                    data.ponPorts?.length ||
                    data.type === 'OLT' ||
                    data.type === 'ODF' ||
                    data.type === 'FDMS' ||
                    data.type === 'FDT' ||
                    data.type === 'FAT') && (
                    <button
                      onClick={() => setModalOpen('portManager', true)}
                      className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-xs flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Grid className="w-3.5 h-3.5" />
                      <span>Manage Ports (Visual Grid)</span>
                    </button>
                  )}

                  <button
                    onClick={() => {
                      navigateToAsset({ id: data.id, name: data.name, lat: data.lat, lng: data.lng, type: data.type });
                      setIsBikerMode(true);
                    }}
                    className="w-full py-2 bg-orange-50 hover:bg-orange-100 text-orange-800 border border-orange-200 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Bike className="w-3.5 h-3.5 text-orange-600" />
                    <span>Navigate to Asset (Biker Mode)</span>
                  </button>

                  <button
                    onClick={() => traceNetworkPath(data.id)}
                    className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Activity className="w-3.5 h-3.5 text-blue-600" />
                    <span>Trace Connections</span>
                  </button>

                  <button
                    onClick={() => deleteEquipment(data.id)}
                    className="w-full py-1.5 text-rose-600 hover:bg-rose-50 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Equipment</span>
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {/* CABLE DETAILS */}
        {type === 'cable' && (
          <>
            {uiMode === 'simple' ? (
              <div className="space-y-3">
                {/* 1. What is this cable? */}
                <div className="bg-cyan-50/80 border border-cyan-200/80 rounded-xl p-3 text-xs text-cyan-900 flex items-start gap-2.5">
                  <span className="text-xl shrink-0 mt-0.5">〰️</span>
                  <div>
                    <div className="font-bold text-[12px]">Fiber Optic Cable Wire</div>
                    <p className="text-[11px] text-cyan-800 leading-relaxed mt-0.5">
                      Contains {data.fiberCount} individual glass fiber cores transmitting internet signals under or
                      above the road.
                    </p>
                  </div>
                </div>

                {/* 2. Length & Route */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-medium">Cable Road Length:</span>
                    <span className="font-bold text-slate-900">
                      {data.lengthMeters} meters ({(data.lengthMeters / 1000).toFixed(2)} km)
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-medium">Installation Type:</span>
                    <span className="font-semibold text-slate-800">{data.installationType}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-medium">Cable Type:</span>
                    <span className="font-semibold text-blue-700">{data.type}</span>
                  </div>
                </div>

                {/* 3. Wire Capacity Breakdown */}
                {(() => {
                  const usedCount = data.cores?.filter((c: any) => c.status === 'In Use').length || 0;
                  const freeCount = Math.max(0, data.fiberCount - usedCount);

                  return (
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                        <span>Wire Capacity</span>
                        <span className="text-blue-600 font-mono text-[11px]">
                          {usedCount} / {data.fiberCount} Connected
                        </span>
                      </div>

                      <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden flex border border-slate-300">
                        <div
                          className="bg-blue-600 h-full"
                          title="In Use"
                          style={{ width: `${(usedCount / data.fiberCount) * 100}%` }}
                        />
                        <div
                          className="bg-emerald-500 h-full"
                          title="Free Available"
                          style={{ width: `${(freeCount / data.fiberCount) * 100}%` }}
                        />
                      </div>

                      <div className="text-[11px] text-slate-600 bg-white p-2 rounded-lg border border-slate-200/80 space-y-1">
                        <div className="flex justify-between">
                          <span>🏠 Wires Powering Homes:</span>
                          <span className="font-bold text-blue-700">{usedCount} In Use</span>
                        </div>
                        <div className="flex justify-between">
                          <span>✨ Free Wires for Expansion:</span>
                          <span className="font-bold text-emerald-700">{freeCount} Free</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* 4. Action Buttons */}
                <div className="space-y-2 pt-1">
                  <button
                    onClick={() => setPanelOpen('bottom', true)}
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-sm flex items-center justify-center gap-2 transition-all"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>View Wire Colors (TIA-598 Sequence)</span>
                  </button>

                  <button
                    onClick={() => setModalOpen('splicing', true)}
                    className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors"
                  >
                    <GitBranch className="w-3.5 h-3.5 text-cyan-600" />
                    <span>Cable Splicing Joint Box</span>
                  </button>

                  <button
                    onClick={() => deleteCable(data.id)}
                    className="w-full py-1 text-rose-500 hover:bg-rose-50 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Delete Cable Route</span>
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="bg-slate-50 rounded-xl p-3 border border-slate-200/70 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Cable Type:</span>
                    <span className="font-semibold text-slate-800">{data.type}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Total Fiber Cores:</span>
                    <span className="font-bold text-blue-600">{data.fiberCount} Cores</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Calculated Length:</span>
                    <span className="font-semibold text-slate-800">
                      {data.lengthMeters} meters ({(data.lengthMeters / 1000).toFixed(2)} km)
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Installation:</span>
                    <span className="font-semibold text-slate-800">{data.installationType}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Cable Owner:</span>
                    <span className="font-semibold text-slate-800">{data.owner}</span>
                  </div>
                </div>

                {/* Fiber Core Utilization Bar */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="font-medium text-slate-600">Core Capacity Breakdown:</span>
                    <span className="font-bold text-slate-800">
                      {data.cores?.filter((c: any) => c.status === 'In Use').length || 0} / {data.fiberCount} in use
                    </span>
                  </div>
                  <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden flex border border-slate-200">
                    <div
                      className="bg-blue-600 h-full"
                      title="In Use"
                      style={{
                        width: `${((data.cores?.filter((c: any) => c.status === 'In Use').length || 0) / data.fiberCount) * 100}%`,
                      }}
                    />
                    <div
                      className="bg-amber-500 h-full"
                      title="Reserved"
                      style={{
                        width: `${((data.cores?.filter((c: any) => c.status === 'Reserved').length || 0) / data.fiberCount) * 100}%`,
                      }}
                    />
                    <div
                      className="bg-rose-500 h-full"
                      title="Damaged"
                      style={{
                        width: `${((data.cores?.filter((c: any) => c.status === 'Damaged').length || 0) / data.fiberCount) * 100}%`,
                      }}
                    />
                    <div
                      className="bg-emerald-500 h-full"
                      title="Available"
                      style={{
                        width: `${((data.cores?.filter((c: any) => c.status === 'Available').length || 0) / data.fiberCount) * 100}%`,
                      }}
                    />
                  </div>

                  {/* Legend */}
                  <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-blue-600"></span> In Use
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Available
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-amber-500"></span> Reserved
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-rose-500"></span> Damaged
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="pt-2 border-t border-slate-100 space-y-2">
                  <button
                    onClick={() => setPanelOpen('bottom', true)}
                    className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-xs flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>Open Fiber Core Allocation Table</span>
                  </button>

                  <button
                    onClick={() => setModalOpen('splicing', true)}
                    className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <GitBranch className="w-3.5 h-3.5 text-cyan-600" />
                    <span>Cable Splicing Matrix</span>
                  </button>

                  <button
                    onClick={() => deleteCable(data.id)}
                    className="w-full py-1.5 text-rose-600 hover:bg-rose-50 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Cable Route</span>
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {/* CUSTOMER DETAILS */}
        {type === 'customer' && (
          <>
            {uiMode === 'simple' ? (
              <div className="space-y-3">
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-start gap-2.5">
                  <span className="text-xl shrink-0 mt-0.5">🏠</span>
                  <div>
                    <div className="font-bold text-xs text-emerald-900">{data.name}</div>
                    <div className="text-[11px] text-emerald-700 font-semibold mt-0.5">
                      🟢 Connected & Working Great
                    </div>
                  </div>
                </div>

                <div className="bg-slate-50 rounded-xl p-3 border border-slate-200/70 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Phone:</span>
                    <span className="font-semibold text-slate-800">{data.mobile}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Plan:</span>
                    <span className="font-bold text-blue-700">{data.plan}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Home Modem ID:</span>
                    <span className="font-mono text-slate-800">{data.ontSerialNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Plugged into:</span>
                    <span className="font-semibold text-slate-800">
                      Box {data.terminalBoxId} (Port #{data.splitterOutputPort})
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => traceNetworkPath(data.id)}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-sm flex items-center justify-center gap-2 transition-all"
                >
                  <Activity className="w-3.5 h-3.5" />
                  <span>Follow Wire Back to Main Station</span>
                </button>
              </div>
            ) : (
              <>
                <div className="bg-slate-50 rounded-xl p-3 border border-slate-200/70 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Subscriber Name:</span>
                    <span className="font-semibold text-slate-800">{data.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Mobile Phone:</span>
                    <span className="font-semibold text-slate-800">{data.mobile}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Subscription Plan:</span>
                    <span className="font-bold text-blue-700">{data.plan}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Assigned IP:</span>
                    <span className="font-mono text-slate-800">{data.ipAddress}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">ONT Serial:</span>
                    <span className="font-mono text-slate-800">{data.ontSerialNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Rx Optical Signal:</span>
                    <span
                      className={`font-bold ${data.rxOpticalPowerDbm < -24 ? 'text-rose-600' : 'text-emerald-600'}`}
                    >
                      {data.rxOpticalPowerDbm} dBm (Optimal)
                    </span>
                  </div>
                </div>

                {/* Logical Upstream Path Breadcrumbs */}
                <div className="space-y-1.5">
                  <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    Upstream Network Path
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-200 text-[11px] space-y-1 text-slate-700">
                    <div className="flex items-center gap-1 font-semibold text-blue-700">
                      <span>OLT Hub: {data.oltId}</span>
                      <ArrowRight className="w-3 h-3 text-slate-400" />
                      <span>Port: {data.ponPort}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span>Feeder: {data.feederCableId}</span>
                      <ArrowRight className="w-3 h-3 text-slate-400" />
                      <span>Dist: {data.distributionCableId}</span>
                    </div>
                    <div className="flex items-center gap-1 font-semibold text-emerald-700">
                      <span>Terminal: {data.terminalBoxId}</span>
                      <ArrowRight className="w-3 h-3 text-slate-400" />
                      <span>
                        Splitter: {data.splitterId} (Port {data.splitterOutputPort})
                      </span>
                    </div>
                  </div>
                </div>

                {/* Trace Action */}
                <div className="pt-2 border-t border-slate-100">
                  <button
                    onClick={() => traceNetworkPath(data.id)}
                    className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow-xs flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Activity className="w-3.5 h-3.5" />
                    <span>Trace End-to-End OLT Path</span>
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {/* FAULT DETAILS */}
        {type === 'fault' && (
          <>
            {uiMode === 'simple' ? (
              <div className="space-y-3">
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 flex items-start gap-2.5">
                  <span className="text-xl shrink-0 mt-0.5">⚠️</span>
                  <div>
                    <div className="font-bold text-xs text-rose-900">{data.title}</div>
                    <div className="text-[11px] text-rose-700 font-semibold mt-0.5">🔴 Broken Fiber Line Problem</div>
                  </div>
                </div>

                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 space-y-1.5 text-xs">
                  <div>
                    <span className="text-slate-500">What Happened:</span>
                    <p className="font-medium text-slate-800 mt-0.5">{data.description}</p>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-slate-200">
                    <span className="text-slate-500">Assigned Technician:</span>
                    <span className="font-bold text-slate-800">{data.assignedTechnician}</span>
                  </div>
                </div>

                <div className="bg-rose-100/80 p-2.5 rounded-xl text-xs font-bold text-rose-900 flex items-center justify-between">
                  <span>Houses Without Internet:</span>
                  <span className="bg-rose-600 text-white text-[11px] px-2 py-0.5 rounded-full">
                    {data.affectedCustomerIds.length} Offline
                  </span>
                </div>

                <div className="space-y-2 pt-1">
                  <button
                    onClick={() => {
                      navigateToAsset({ id: data.id, name: data.title, ...data.affectedLocation, type: 'fault' });
                      setIsBikerMode(true);
                    }}
                    className="w-full py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white rounded-xl text-xs font-bold shadow-md shadow-orange-500/20 flex items-center justify-center gap-2 transition-all"
                  >
                    <Bike className="w-4 h-4" />
                    <span>Navigate to Broken Spot (Bike GPS)</span>
                  </button>

                  <button
                    onClick={() => setModalOpen('faults', true)}
                    className="w-full py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold shadow-sm flex items-center justify-center gap-2 transition-colors"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Open Repair Ticket</span>
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="bg-rose-50 rounded-xl p-3 border border-rose-200 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-rose-700 font-medium">Fault Type:</span>
                    <span className="font-bold text-rose-900">{data.type}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-rose-700 font-medium">Severity:</span>
                    <span className="font-bold text-rose-900">{data.severity}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-rose-700 font-medium">Reported At:</span>
                    <span className="text-rose-900">{data.reportedAt}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-rose-700 font-medium">Assigned Tech:</span>
                    <span className="font-semibold text-rose-900">{data.assignedTechnician}</span>
                  </div>
                </div>

                <div>
                  <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                    Impact Analysis
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                    {data.description}
                  </p>
                </div>

                <div className="bg-slate-100 p-2.5 rounded-lg text-xs font-semibold text-slate-800 flex items-center justify-between">
                  <span>Downstream Outage:</span>
                  <span className="text-rose-600 font-bold">{data.affectedCustomerIds.length} Customers Offline</span>
                </div>

                <button
                  onClick={() => setModalOpen('faults', true)}
                  className="w-full py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold shadow-xs flex items-center justify-center gap-1.5 transition-colors"
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Manage Outage & Work Order</span>
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};
