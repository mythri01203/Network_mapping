import React, { useState } from 'react';
import {
  AlertTriangle,
  Box,
  Camera,
  Cpu,
  GitFork,
  Home,
  Layers,
  MapPin,
  RefreshCw,
  Search,
  Server,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { useOpenView } from '../../app/views';
import { useMapStore } from '../../stores/mapStore';
import { traceNetworkPath } from '../../stores/networkActions';
import { useNetworkStore } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';

export const NetworkTopologyView: React.FC = () => {
  const { equipments, customers, faults } = useNetworkStore(
    useShallow((s) => ({ equipments: s.equipment, customers: s.customers, faults: s.faults })),
  );
  const flyToLocation = useMapStore((s) => s.flyTo);
  const setModalOpen = useUiStore((s) => s.setModalOpen);
  const openView = useOpenView();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedArea, setSelectedArea] = useState<string>('All');
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [selectedNode, setSelectedNode] = useState<{
    id: string;
    name: string;
    type: string;
    category: string;
    status: string;
    details: string;
    opticalPower?: string;
    parent?: string;
    lat?: number;
    lng?: number;
    raw?: any;
  } | null>(null);

  // Group equipment into hierarchical tiers
  const oltNodes = equipments.filter((e) => e.type === 'OLT');
  const fdmsNodes = equipments.filter((e) => e.type === 'FDMS');
  const fdtNodes = equipments.filter((e) => e.type === 'FDT');
  const fatNodes = equipments.filter((e) => e.type === 'FAT' || e.type.includes('Terminal Box'));

  // Filter based on area and search
  const matchesFilter = (item: { id: string; name: string; area?: string }) => {
    const matchesSearch =
      searchQuery === '' ||
      item.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesArea = selectedArea === 'All' || item.area === selectedArea;
    return matchesSearch && matchesArea;
  };

  const areas = ['All', 'Koramangala', 'Indiranagar', 'HSR Layout', 'Whitefield'];

  const handleNodeClick = (node: any) => {
    setSelectedNode(node);
  };

  const handleLocateOnMap = (lat?: number, lng?: number) => {
    if (lat && lng) {
      openView('map');
      setTimeout(() => {
        flyToLocation(lat, lng, 18);
      }, 100);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 overflow-hidden select-none">
      {/* Top Controls Bar */}
      <div className="h-14 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0 shadow-xs z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
            <GitFork className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-800">End-to-End Optical Network Topology</h2>
            <p className="text-[11px] text-slate-500">
              Hierarchical visual schematic from Central Office OLTs to Customer ONTs
            </p>
          </div>
        </div>

        {/* Filter & Search Toolbar */}
        <div className="flex items-center gap-3">
          {/* Area Selector */}
          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <Layers className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={selectedArea}
              onChange={(e) => setSelectedArea(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200/80 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 outline-none transition-colors"
            >
              {areas.map((a) => (
                <option key={a} value={a}>
                  {a === 'All' ? 'All Coverage Zones' : a}
                </option>
              ))}
            </select>
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search topology node..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 bg-slate-100 hover:bg-slate-200/80 focus:bg-white border border-slate-200 focus:border-blue-500 rounded-lg text-xs outline-none transition-all w-48"
            />
          </div>

          {/* Zoom controls */}
          <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200">
            <button
              onClick={() => setZoomLevel((prev) => Math.max(0.6, prev - 0.1))}
              className="p-1 hover:bg-white rounded text-slate-600 hover:text-slate-900 transition-colors"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] font-semibold text-slate-600 px-2">{Math.round(zoomLevel * 100)}%</span>
            <button
              onClick={() => setZoomLevel((prev) => Math.min(1.5, prev + 0.1))}
              className="p-1 hover:bg-white rounded text-slate-600 hover:text-slate-900 transition-colors"
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setZoomLevel(1)}
              className="p-1 hover:bg-white rounded text-slate-600 hover:text-slate-900 transition-colors ml-1"
              title="Reset Zoom"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Workspace with Diagram & Details Sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Topology Schematic Canvas */}
        <div className="flex-1 overflow-auto p-8 flex flex-col items-center">
          <div
            className="transition-transform duration-200 origin-top flex flex-col items-center gap-12 w-full max-w-6xl pb-24"
            style={{ transform: `scale(${zoomLevel})` }}
          >
            {/* TIER 1: CENTRAL OFFICE / OLTs */}
            <div className="w-full flex flex-col items-center">
              <div className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-[11px] font-bold uppercase tracking-wider mb-4 border border-blue-200 flex items-center gap-1.5 shadow-xs">
                <Server className="w-3 h-3 text-blue-600" />
                Tier 1: Central Office Core (OLT & ODF)
              </div>
              <div className="flex flex-wrap justify-center gap-6">
                {oltNodes.filter(matchesFilter).map((olt) => (
                  <div
                    key={olt.id}
                    onClick={() =>
                      handleNodeClick({
                        id: olt.id,
                        name: olt.name,
                        type: olt.type,
                        category: 'Central Office',
                        status: olt.status,
                        details: `Model: ${olt.model || 'Huawei MA5800'} | IP: ${olt.ipAddress || '10.10.1.1'} | Rack: ${olt.rackNumber || 'R01'}`,
                        opticalPower: 'Tx Power: +3.5 dBm (Class C+)',
                        lat: olt.lat,
                        lng: olt.lng,
                        raw: olt,
                      })
                    }
                    className={`p-4 bg-white border-2 rounded-xl shadow-sm hover:shadow-md cursor-pointer transition-all w-64 ${
                      selectedNode?.id === olt.id
                        ? 'border-blue-600 ring-2 ring-blue-100'
                        : 'border-slate-200 hover:border-blue-400'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded border border-blue-200">
                        {olt.id}
                      </span>
                      <span
                        className={`w-2 h-2 rounded-full ${olt.status === 'Active' ? 'bg-emerald-500' : 'bg-rose-500'}`}
                      />
                    </div>
                    <div className="font-bold text-xs text-slate-800">{olt.name}</div>
                    <div className="text-[11px] text-slate-500 mt-1">{olt.area} &bull; 16 PON Ports</div>
                    <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px]">
                      <span className="text-slate-400">Total Subs</span>
                      <span className="font-semibold text-blue-600">
                        {customers.filter((c) => c.oltId === olt.id).length} Active
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Downward Tree Connector */}
            <div className="flex flex-col items-center">
              <div className="h-6 w-0.5 bg-blue-300" />
              <div className="text-[10px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                Main Feeder Cables (48F - 96F Trunk)
              </div>
              <div className="h-6 w-0.5 bg-blue-300" />
            </div>

            {/* TIER 2: PRIMARY DISTRIBUTION (FDMS & Closures) */}
            <div className="w-full flex flex-col items-center">
              <div className="px-3 py-1 bg-indigo-100 text-indigo-800 rounded-full text-[11px] font-bold uppercase tracking-wider mb-4 border border-indigo-200 flex items-center gap-1.5 shadow-xs">
                <Box className="w-3 h-3 text-indigo-600" />
                Tier 2: Primary Cross-Connects (FDMS & Joint Closures)
              </div>
              <div className="flex flex-wrap justify-center gap-6">
                {fdmsNodes.filter(matchesFilter).map((fdms) => (
                  <div
                    key={fdms.id}
                    onClick={() =>
                      handleNodeClick({
                        id: fdms.id,
                        name: fdms.name,
                        type: fdms.type,
                        category: 'Fiber Distribution',
                        status: fdms.status,
                        details: `Street: ${fdms.street} | Total Capacity: ${fdms.totalPorts || 144} Cores`,
                        opticalPower: 'Attenuation: 0.28 dB/km',
                        lat: fdms.lat,
                        lng: fdms.lng,
                        raw: fdms,
                      })
                    }
                    className={`p-3.5 bg-white border-2 rounded-xl shadow-sm hover:shadow-md cursor-pointer transition-all w-56 ${
                      selectedNode?.id === fdms.id
                        ? 'border-indigo-600 ring-2 ring-indigo-100'
                        : 'border-slate-200 hover:border-indigo-400'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">
                        {fdms.id}
                      </span>
                      <span className="text-[10px] text-slate-400">{fdms.area}</span>
                    </div>
                    <div className="font-semibold text-xs text-slate-800">{fdms.name}</div>
                    <div className="mt-2 text-[10px] text-slate-500 flex justify-between">
                      <span>Cores Allocated:</span>
                      <span className="font-bold text-slate-700">
                        {fdms.usedPorts || 38}/{fdms.totalPorts || 96}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Downward Tree Connector */}
            <div className="flex flex-col items-center">
              <div className="h-6 w-0.5 bg-teal-300" />
              <div className="text-[10px] font-semibold text-teal-700 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                Distribution Aerial / Duct Cables (24F)
              </div>
              <div className="h-6 w-0.5 bg-teal-300" />
            </div>

            {/* TIER 3: SECONDARY DISTRIBUTION (FDT Cabinets & Splitters) */}
            <div className="w-full flex flex-col items-center">
              <div className="px-3 py-1 bg-teal-100 text-teal-800 rounded-full text-[11px] font-bold uppercase tracking-wider mb-4 border border-teal-200 flex items-center gap-1.5 shadow-xs">
                <Cpu className="w-3 h-3 text-teal-600" />
                Tier 3: Fiber Distribution Terminals (FDT & 1:4 / 1:8 Splitters)
              </div>
              <div className="flex flex-wrap justify-center gap-4">
                {fdtNodes.filter(matchesFilter).map((fdt) => (
                  <div
                    key={fdt.id}
                    onClick={() =>
                      handleNodeClick({
                        id: fdt.id,
                        name: fdt.name,
                        type: fdt.type,
                        category: 'Fiber Distribution',
                        status: fdt.status,
                        details: `Area: ${fdt.area} | Splitters: ${fdt.splitterConfig?.ratio || '1:8'}`,
                        opticalPower: 'Input: +1.8 dBm | Splitter Loss: 7.2 dB',
                        lat: fdt.lat,
                        lng: fdt.lng,
                        raw: fdt,
                      })
                    }
                    className={`p-3 bg-white border-2 rounded-xl shadow-xs hover:shadow-md cursor-pointer transition-all w-52 ${
                      selectedNode?.id === fdt.id
                        ? 'border-teal-600 ring-2 ring-teal-100'
                        : 'border-slate-200 hover:border-teal-400'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-bold text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded border border-teal-200">
                        {fdt.id}
                      </span>
                      <span className="text-[10px] font-semibold text-slate-500">{fdt.totalPorts || 48}P</span>
                    </div>
                    <div className="font-semibold text-xs text-slate-800 truncate">{fdt.name}</div>
                    <div className="text-[10px] text-slate-400 mt-1 truncate">{fdt.street}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Downward Tree Connector */}
            <div className="flex flex-col items-center">
              <div className="h-6 w-0.5 bg-amber-300" />
              <div className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                Branch Drops & Access Enclosures
              </div>
              <div className="h-6 w-0.5 bg-amber-300" />
            </div>

            {/* TIER 4: ACCESS TERMINALS (FAT Terminal Boxes) */}
            <div className="w-full flex flex-col items-center">
              <div className="px-3 py-1 bg-amber-100 text-amber-800 rounded-full text-[11px] font-bold uppercase tracking-wider mb-4 border border-amber-200 flex items-center gap-1.5 shadow-xs">
                <Box className="w-3 h-3 text-amber-600" />
                Tier 4: Fiber Access Terminals (FAT - 8 to 16 Ports)
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {fatNodes
                  .filter(matchesFilter)
                  .slice(0, 8)
                  .map((fat) => {
                    const hasFault = faults.some((f) => f.affectedEquipmentId === fat.id);
                    const custCount = customers.filter((c) => c.terminalBoxId === fat.id).length;
                    return (
                      <div
                        key={fat.id}
                        onClick={() =>
                          handleNodeClick({
                            id: fat.id,
                            name: fat.name,
                            type: fat.type,
                            category: 'Access Terminal',
                            status: hasFault ? 'Faulty' : fat.status,
                            details: `Pole: ${fat.poleNumber || 'P-12'} | Connected Subscribers: ${custCount}/8`,
                            opticalPower: 'Output Port Signal: -17.5 dBm to -19.2 dBm',
                            lat: fat.lat,
                            lng: fat.lng,
                            raw: fat,
                          })
                        }
                        className={`p-3 bg-white border-2 rounded-xl shadow-xs hover:shadow-md cursor-pointer transition-all ${
                          hasFault
                            ? 'border-rose-400 bg-rose-50/20'
                            : selectedNode?.id === fat.id
                              ? 'border-amber-500 ring-2 ring-amber-100'
                              : 'border-slate-200 hover:border-amber-400'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-bold text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                            {fat.id}
                          </span>
                          {hasFault ? (
                            <AlertTriangle className="w-3.5 h-3.5 text-rose-500 animate-pulse" />
                          ) : (
                            <span className="text-[10px] font-semibold text-emerald-600">{custCount}/8 Used</span>
                          )}
                        </div>
                        <div className="font-semibold text-xs text-slate-800 truncate">{fat.name}</div>
                        <div className="text-[10px] text-slate-400 truncate mt-0.5">{fat.street}</div>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* Downward Tree Connector */}
            <div className="flex flex-col items-center">
              <div className="h-6 w-0.5 bg-emerald-300" />
              <div className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                1F/2F FTTH Drop Cables
              </div>
              <div className="h-6 w-0.5 bg-emerald-300" />
            </div>

            {/* TIER 5: SUBSCRIBER ONTS & CUSTOMER PREMISES */}
            <div className="w-full flex flex-col items-center">
              <div className="px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full text-[11px] font-bold uppercase tracking-wider mb-4 border border-emerald-200 flex items-center gap-1.5 shadow-xs">
                <Home className="w-3 h-3 text-emerald-600" />
                Tier 5: Customer ONT & Cable TV Endpoints
              </div>
              <div className="flex flex-wrap justify-center gap-3">
                {customers
                  .filter((c) => matchesFilter({ id: c.id, name: c.name, area: c.area }))
                  .slice(0, 10)
                  .map((cust) => (
                    <div
                      key={cust.id}
                      onClick={() =>
                        handleNodeClick({
                          id: cust.id,
                          name: cust.name,
                          type: cust.serviceType,
                          category: 'Subscriber ONT',
                          status: cust.status,
                          details: `ONT Serial: ${cust.ontSerialNumber} | Plan: ${cust.plan} | IP: ${cust.ipAddress}`,
                          opticalPower: `Rx Optical Power: ${cust.rxOpticalPowerDbm} dBm`,
                          lat: cust.lat,
                          lng: cust.lng,
                          raw: cust,
                        })
                      }
                      className={`p-2.5 bg-white border-2 rounded-xl shadow-2xs hover:shadow-xs cursor-pointer transition-all w-48 ${
                        selectedNode?.id === cust.id
                          ? 'border-emerald-600 ring-2 ring-emerald-100'
                          : 'border-slate-200 hover:border-emerald-400'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10px] mb-1">
                        <span className="font-mono text-emerald-700 bg-emerald-50 px-1 py-0.5 rounded">{cust.id}</span>
                        <span className="font-semibold text-slate-500">{cust.rxOpticalPowerDbm} dBm</span>
                      </div>
                      <div className="font-semibold text-xs text-slate-800 truncate">{cust.name}</div>
                      <div className="text-[10px] text-slate-400 truncate">{cust.address}</div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right Node Inspector Panel */}
        {selectedNode && (
          <aside className="w-80 bg-white border-l border-slate-200 p-4 flex flex-col justify-between overflow-y-auto shrink-0 shadow-lg animate-in slide-in-from-right-4">
            <div>
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 font-bold text-xs">
                    {selectedNode.type.slice(0, 3)}
                  </div>
                  <div>
                    <div className="font-bold text-xs text-slate-900">{selectedNode.name}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{selectedNode.id}</div>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedNode(null)}
                  className="text-slate-400 hover:text-slate-700 text-xs px-2 py-1 rounded hover:bg-slate-100"
                >
                  &times;
                </button>
              </div>

              {/* Status and Specs */}
              <div className="space-y-3 text-xs">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Operational Status</span>
                  <div className="mt-1 flex items-center gap-2">
                    <span
                      className={`w-2.5 h-2.5 rounded-full ${selectedNode.status === 'Faulty' ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500'}`}
                    />
                    <span className="font-semibold text-slate-800">{selectedNode.status}</span>
                  </div>
                </div>

                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Technical Specifications</span>
                  <p className="mt-1 text-slate-600 bg-slate-50 p-2 rounded-lg border border-slate-100 leading-relaxed text-[11px]">
                    {selectedNode.details}
                  </p>
                </div>

                {selectedNode.opticalPower && (
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Optical Power Telemetry</span>
                    <div className="mt-1 bg-emerald-50 border border-emerald-200 text-emerald-800 p-2 rounded-lg font-mono text-[11px] font-medium">
                      {selectedNode.opticalPower}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Actions Toolbar */}
            <div className="border-t border-slate-100 pt-3 mt-4 space-y-2">
              <button
                onClick={() => handleLocateOnMap(selectedNode.lat, selectedNode.lng)}
                className="w-full py-2 px-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 shadow-sm transition-all"
              >
                <MapPin className="w-3.5 h-3.5" />
                <span>Locate on GIS Map</span>
              </button>

              <button
                onClick={() => traceNetworkPath(selectedNode.id)}
                className="w-full py-2 px-3 bg-white hover:bg-slate-100 border border-slate-200 text-slate-800 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 shadow-xs transition-all"
              >
                <GitFork className="w-3.5 h-3.5 text-blue-600" />
                <span>Trace Complete Fiber Route</span>
              </button>

              {(selectedNode.type === 'FAT' || selectedNode.type.includes('Terminal Box')) && (
                <button
                  onClick={() => setModalOpen('terminalBox', true)}
                  className="w-full py-1.5 px-3 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>Inspect Terminal Box & Photos</span>
                </button>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
};
