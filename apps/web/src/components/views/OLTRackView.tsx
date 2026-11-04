import React, { useState } from 'react';
import { traceNetworkPath } from '../../stores/networkActions';
import { useShallow } from 'zustand/react/shallow';
import { useUiStore } from '../../stores/uiStore';
import { useMapStore } from '../../stores/mapStore';
import { useNetworkStore } from '../../stores/networkStore';
import { useOpenView } from '../../app/views';
import { Server, Zap, Activity, Fan, Radio, MapPin, GitFork, Thermometer } from 'lucide-react';

export const OLTRackView: React.FC = () => {
  const { equipments, cables, customers, faults } = useNetworkStore(
    useShallow((s) => ({ equipments: s.equipment, cables: s.cables, customers: s.customers, faults: s.faults })),
  );
  const flyToLocation = useMapStore((s) => s.flyTo);
  const setModalOpen = useUiStore((s) => s.setModalOpen);
  const openView = useOpenView();

  const olts = equipments.filter((e) => e.type === 'OLT');
  const [selectedOltId, setSelectedOltId] = useState<string>(olts[0]?.id || 'OLT-01');
  const [selectedPonPort, setSelectedPonPort] = useState<number | null>(1);

  const currentOlt = equipments.find((e) => e.id === selectedOltId) || olts[0];

  // PON port data generator
  const ponPorts = Array.from({ length: 16 }, (_, i) => {
    const portNum = i + 1;
    const connectedFeeder = cables.find((c) => c.type === 'Main Feeder Fiber');
    const portCustomers = customers.filter(
      (c) => c.oltId === selectedOltId && c.ponPort === `PON-${portNum.toString().padStart(2, '0')}`,
    );
    const isFaulty = faults.some((f) => f.affectedEquipmentId === selectedOltId);
    const hasSubscribers = portCustomers.length > 0;

    return {
      portNumber: portNum,
      name: `PON-${portNum.toString().padStart(2, '0')}`,
      status: isFaulty && portNum === 4 ? 'Alarm' : hasSubscribers ? 'Active' : portNum <= 8 ? 'Active' : 'Standby',
      txPowerDbm: +(3.2 + (portNum % 4) * 0.3).toFixed(2),
      connectedFeederId: connectedFeeder?.id || 'CBL-FEEDER-01',
      connectedFeederName: connectedFeeder?.name || 'Trunk Feeder Cable 01',
      subscribersCount: portCustomers.length || (portNum <= 8 ? 24 + portNum : 0),
      maxCapacity: 64,
      splitRatio: '1:64 (Two-Stage 1:8 + 1:8)',
      wavelength: '1490nm Tx / 1310nm Rx',
      transceiver: 'Class C+ XFP / SFP+',
    };
  });

  const selectedPortData = ponPorts.find((p) => p.portNumber === selectedPonPort) || ponPorts[0];

  const handleLocateOnMap = () => {
    if (currentOlt) {
      openView('map');
      setTimeout(() => {
        flyToLocation(currentOlt.lat, currentOlt.lng, 18);
      }, 100);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-900 text-slate-100 overflow-hidden select-none">
      {/* Top Header Bar */}
      <div className="h-14 bg-slate-950 border-b border-slate-800 px-6 flex items-center justify-between shrink-0 shadow-md z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
            <Server className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-white tracking-wide">Central Office OLT Chassis Rack Visualizer</h2>
              <span className="text-[10px] font-semibold bg-blue-900/60 text-blue-300 border border-blue-700/60 px-1.5 py-0.5 rounded">
                19-INCH TELECOM RACK
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Huawei SmartAX MA5800-X15 / Nokia 7360 FX-4 Optical Line Terminal
            </p>
          </div>
        </div>

        {/* Chassis Selector & Metrics */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-400">Active Chassis:</span>
            <select
              value={selectedOltId}
              onChange={(e) => setSelectedOltId(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-1.5 text-xs font-semibold outline-none focus:border-blue-500"
            >
              {olts.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.id})
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleLocateOnMap}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold transition-all shadow-xs"
          >
            <MapPin className="w-3.5 h-3.5" />
            <span>Locate Chassis on Map</span>
          </button>
        </div>
      </div>

      {/* Main Rack Chassis & Inspector */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left 19-inch Telecom Rack Physical Chassis Visualization */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-start bg-slate-900/90">
          <div className="w-full max-w-4xl bg-slate-950 border-4 border-slate-700 rounded-2xl p-6 shadow-2xl relative">
            {/* Rack Mount Ears and Screws */}
            <div className="absolute top-3 left-2 flex flex-col gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-slate-600 border border-slate-500 shadow-inner" />
              <div className="w-2.5 h-2.5 rounded-full bg-slate-600 border border-slate-500 shadow-inner" />
            </div>
            <div className="absolute top-3 right-2 flex flex-col gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-slate-600 border border-slate-500 shadow-inner" />
              <div className="w-2.5 h-2.5 rounded-full bg-slate-600 border border-slate-500 shadow-inner" />
            </div>

            {/* Chassis Header / Top PDU Banner */}
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-800">
              <div className="flex items-center gap-4">
                <span className="font-mono text-xs font-bold text-slate-300 tracking-wider">
                  HUAWEI SMARTAX MA5800-X7
                </span>
                <span className="text-[10px] text-emerald-400 font-mono bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800/80 flex items-center gap-1">
                  <Activity className="w-3 h-3" /> NORMAL TELEMETRY
                </span>
              </div>
              <div className="flex items-center gap-4 text-xs font-mono text-slate-400">
                <div className="flex items-center gap-1">
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  <span>Dual -48V DC (Active)</span>
                </div>
                <div className="flex items-center gap-1">
                  <Thermometer className="w-3.5 h-3.5 text-sky-400" />
                  <span>34.2&deg;C</span>
                </div>
                <div className="flex items-center gap-1">
                  <Fan className="w-3.5 h-3.5 text-slate-400 animate-spin" />
                  <span>4200 RPM</span>
                </div>
              </div>
            </div>

            {/* Shelf Slots Section */}
            <div className="space-y-4">
              {/* Slot 0: Uplink & Control MPU Board */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[11px] font-bold text-slate-400 w-16">SLOT 00 (MPU)</span>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-xs font-semibold text-slate-200">Main Control & 4x10GE Uplink Unit</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {['10GE-UP-01', '10GE-UP-02', '100GE-CORE', 'SYNC-BITS'].map((port, idx) => (
                    <div
                      key={port}
                      className="flex flex-col items-center bg-slate-950 border border-slate-700 px-2 py-1 rounded"
                    >
                      <span className="text-[9px] font-mono text-blue-400">{port}</span>
                      <span
                        className={`w-1.5 h-1.5 rounded-full mt-1 ${idx < 2 ? 'bg-emerald-400' : 'bg-slate-600'}`}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Slot 1: GPON 16-Port Service Board (Interactive) */}
              <div className="bg-slate-900/90 border-2 border-blue-500/30 rounded-xl p-4 shadow-inner">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-[11px] font-bold text-blue-400 bg-blue-950/60 border border-blue-800/80 px-2 py-0.5 rounded">
                      SLOT 01 (GPON-16)
                    </span>
                    <span className="text-xs font-bold text-white">H901GPHF 16-Port GPON Interface Card</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">ITU-T G.984.2 Standard Compliant</span>
                </div>

                {/* 16 Optical PON Ports Grid */}
                <div className="grid grid-cols-4 sm:grid-cols-8 gap-2.5">
                  {ponPorts.map((p) => {
                    const isSelected = selectedPonPort === p.portNumber;
                    const isActive = p.status === 'Active';
                    const isAlarm = p.status === 'Alarm';

                    return (
                      <button
                        key={p.portNumber}
                        onClick={() => setSelectedPonPort(p.portNumber)}
                        className={`flex flex-col items-center justify-between p-2 rounded-lg border transition-all ${
                          isSelected
                            ? 'bg-blue-600/30 border-blue-400 ring-2 ring-blue-500/50'
                            : isAlarm
                              ? 'bg-rose-950/40 border-rose-600/60 hover:border-rose-500'
                              : 'bg-slate-950 border-slate-800 hover:border-slate-600'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full mb-1">
                          <span className="text-[10px] font-mono font-bold text-slate-300">#{p.portNumber}</span>
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              isAlarm ? 'bg-rose-500 animate-ping' : isActive ? 'bg-emerald-400' : 'bg-slate-600'
                            }`}
                          />
                        </div>

                        {/* Visual SFP Optical Cage Graphic */}
                        <div className="w-7 h-4 bg-slate-800 border border-slate-600 rounded-xs flex items-center justify-center my-1">
                          <div className="w-4 h-2 bg-slate-950 rounded-xs border border-slate-700" />
                        </div>

                        <span className="text-[9px] font-mono text-slate-400 mt-1">{p.txPowerDbm} dBm</span>
                        <span className="text-[9px] text-blue-300 font-semibold">{p.subscribersCount} Subs</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Slot 2: XGS-PON 8-Port High Speed Card */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center justify-between opacity-80">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[11px] font-bold text-slate-400 w-16">SLOT 02</span>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="text-xs font-semibold text-slate-300">XGS-PON 10G Symm SFP+ (8 Ports)</span>
                  </div>
                </div>
                <span className="text-[10px] font-mono text-amber-400 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800/80">
                  RESERVED FOR 10G UPGRADE
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right PON Port Telemetry & Customer Allocation Inspector */}
        <aside className="w-88 bg-slate-950 border-l border-slate-800 p-5 flex flex-col justify-between overflow-y-auto shrink-0 shadow-2xl">
          <div>
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-600/30 border border-blue-500/50 flex items-center justify-center text-blue-400 font-bold text-xs">
                  {selectedPortData.name}
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white">Port Telemetry & Assignment</h3>
                  <p className="text-[11px] text-slate-400">{currentOlt.name}</p>
                </div>
              </div>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                  selectedPortData.status === 'Alarm'
                    ? 'bg-rose-950 text-rose-400 border-rose-800'
                    : 'bg-emerald-950 text-emerald-400 border-emerald-800'
                }`}
              >
                {selectedPortData.status}
              </span>
            </div>

            {/* Technical Specifications List */}
            <div className="space-y-3.5 text-xs">
              <div className="bg-slate-900 p-3 rounded-xl border border-slate-800 space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-400">Optical Tx Power:</span>
                  <span className="font-mono font-bold text-emerald-400">+{selectedPortData.txPowerDbm} dBm</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Wavelength Standards:</span>
                  <span className="font-mono text-slate-200">{selectedPortData.wavelength}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Transceiver Type:</span>
                  <span className="font-mono text-slate-200">{selectedPortData.transceiver}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Optical Split Ratio:</span>
                  <span className="font-mono text-slate-200">{selectedPortData.splitRatio}</span>
                </div>
              </div>

              {/* Connected Feeder Cable */}
              <div className="bg-slate-900 p-3 rounded-xl border border-slate-800">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Outgoing Feeder Trunk
                </span>
                <div className="mt-1.5 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-white text-xs">{selectedPortData.connectedFeederName}</div>
                    <div className="text-[10px] font-mono text-blue-400">{selectedPortData.connectedFeederId}</div>
                  </div>
                  <span className="text-[10px] bg-blue-950 text-blue-300 border border-blue-800 px-2 py-0.5 rounded">
                    Core 01 (Blue)
                  </span>
                </div>
              </div>

              {/* Subscriber Capacity Gauge */}
              <div className="bg-slate-900 p-3 rounded-xl border border-slate-800">
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-slate-400">Subscriber Port Capacity:</span>
                  <span className="font-bold text-white">
                    {selectedPortData.subscribersCount} / {selectedPortData.maxCapacity} (
                    {Math.round((selectedPortData.subscribersCount / selectedPortData.maxCapacity) * 100)}%)
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all"
                    style={{ width: `${(selectedPortData.subscribersCount / selectedPortData.maxCapacity) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="border-t border-slate-800 pt-4 space-y-2">
            <button
              onClick={() => traceNetworkPath(selectedOltId)}
              className="w-full py-2.5 px-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 shadow-md transition-all"
            >
              <GitFork className="w-3.5 h-3.5" />
              <span>Trace Fiber Path From This Port</span>
            </button>

            <button
              onClick={() => setModalOpen('cableWizard', true)}
              className="w-full py-2 px-3 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all"
            >
              <Radio className="w-3.5 h-3.5 text-blue-400" />
              <span>Map New Feeder Cable from OLT</span>
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
};
