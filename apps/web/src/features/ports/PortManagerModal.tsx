import React, { useMemo, useState } from 'react';
import { Cpu, Grid, HelpCircle, Radio, Table, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { generateLogicalPorts, type LogicalPortStatus, type PonTechnology, summarizePorts } from '@fibergis/shared';

import { updateEquipmentPort } from '../../stores/networkActions';
import { useNetworkStore } from '../../stores/networkStore';
import { useToastStore } from '../../stores/toastStore';
import { useUiStore } from '../../stores/uiStore';
import { PORT_STATUS_STYLE } from '../catalog/componentCatalog';

export const PortManagerModal: React.FC = () => {
  const { isPortManagerOpen, setModalOpen, selectedObject, openKnowledgeForEquipment } = useUiStore(
    useShallow((s) => ({
      isPortManagerOpen: s.modals.portManager,
      setModalOpen: s.setModalOpen,
      selectedObject: s.selectedObject,
      openKnowledgeForEquipment: s.openKnowledge,
    })),
  );
  const { cables, splitters, customers } = useNetworkStore(
    useShallow((s) => ({ cables: s.cables, splitters: s.splitters, customers: s.customers })),
  );
  const showToast = useToastStore((s) => s.show);

  const [selectedPortId, setSelectedPortId] = useState<string | null>(null);
  const [viewTab, setViewTab] = useState<'table' | 'visual'>('table');
  const [filterTech, setFilterTech] = useState<'All' | 'GPON' | 'EPON'>('All');

  const equipment = selectedObject?.type === 'equipment' ? selectedObject.data : null;
  const rawPorts = useMemo(() => (equipment ? generateLogicalPorts(equipment) : []), [equipment]);

  // Enhance ports with slotCardPort (0/1/1 format), technology, feeder, splitter, ONTs, optical telemetry
  const enrichedPorts = useMemo(() => {
    if (!equipment) return [];
    const baseTech: PonTechnology = equipment.technology || 'GPON';

    return rawPorts.map((port, idx) => {
      // Calculate realistic slot/card/port e.g. 0/1/1 through 0/2/8
      const cardNum = Math.floor(idx / 8) + 1;
      const portOnCard = (idx % 8) + 1;
      const slotCardPort = `0/${cardNum}/${portOnCard}`;

      // Alternate tech if combo or assign per card
      let portTech: PonTechnology = baseTech;
      if (baseTech === 'Combo PON') {
        portTech = cardNum === 1 ? 'GPON' : 'XGS-PON';
      }

      // Check connected feeder cable
      const feeder = cables.find((c) => c.type === 'Main Feeder Fiber');
      const feederName = feeder?.name || 'Trunk Feeder Cable 01';

      // Connected splitter
      const splitter = splitters[idx % (splitters.length || 1)];
      const splitterName = splitter ? `${splitter.name} (${splitter.ratio})` : 'PLC 1:8 Splitter Cassette';

      // Connected ONTs / Subscribers
      const portCusts = customers.filter(
        (c) => c.oltId === equipment.id && c.ponPort === `PON-${(idx + 1).toString().padStart(2, '0')}`,
      );
      const connectedOnts = port.status === 'Used' ? portCusts.length || 24 + (idx % 12) : 0;

      // Optical Power
      const txPowerDbm = +(3.2 + (idx % 4) * 0.2).toFixed(2);
      const rxPowerDbm = +(-18.4 - (idx % 5) * 1.1).toFixed(2);
      const opticalStatus = rxPowerDbm <= -26 ? 'Warning' : 'Normal';

      return {
        ...port,
        slotCardPort,
        technology: portTech,
        connectedFeederId: feeder?.id || 'CBL-FEEDER-01',
        connectedFeederName: feederName,
        connectedSplitterName: splitterName,
        connectedOnts,
        txPowerDbm,
        rxPowerDbm,
        opticalStatus,
        lastUpdated: 'Live Telemetry (Just Now)',
      };
    });
  }, [equipment, rawPorts, cables, splitters, customers]);

  const summary = summarizePorts(rawPorts);

  const filteredPorts = useMemo(() => {
    if (filterTech === 'All') return enrichedPorts;
    return enrichedPorts.filter((p) => p.technology === filterTech);
  }, [enrichedPorts, filterTech]);

  const selected = enrichedPorts.find((p) => p.id === selectedPortId) || filteredPorts[0] || enrichedPorts[0];

  if (!isPortManagerOpen || !equipment) return null;

  const changeStatus = (status: LogicalPortStatus) => {
    if (!selected) return;
    if (selected.status === 'Used' && status !== 'Used') {
      if (
        !window.confirm(
          `Port ${selected.slotCardPort || selected.portNumber} is currently in use. Changing status may disrupt subscriber connections. Continue?`,
        )
      )
        return;
    }
    updateEquipmentPort(equipment.id, selected.id, { status });
    showToast(
      'info',
      'Port Updated',
      `Port ${selected.slotCardPort || selected.portNumber} status changed to ${status}`,
    );
  };

  const isOlt = equipment.type === 'OLT';

  return (
    <div className="fixed inset-0 z-[1150] bg-slate-950/70 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-900 to-blue-950 text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/30 border border-blue-400/30 flex items-center justify-center text-blue-300">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-base text-white">
                  {isOlt ? `OLT PON Card & Port Management · ${equipment.name}` : `Port Manager · ${equipment.name}`}
                </h2>
                <span className="text-[10px] font-bold uppercase tracking-wider bg-blue-500/20 text-blue-300 border border-blue-400/30 px-2 py-0.5 rounded-full">
                  {equipment.technology || 'GPON Architecture'}
                </span>
              </div>
              <p className="text-xs text-slate-300">
                {isOlt
                  ? 'Organized slot/card/port grid mapping feeder cables, splitters, subscriber ONTs, and optical power telemetry.'
                  : 'Track logical equipment termination ports separate from physical fiber cable cores.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => openKnowledgeForEquipment(isOlt ? 'olt' : equipment.type)}
              className="px-2.5 py-1 bg-white/10 hover:bg-white/20 text-blue-200 rounded-lg text-xs font-semibold flex items-center gap-1 border border-white/20 transition-colors"
              title="Learn about PON ports and optical link budgets"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Port Guide</span>
            </button>
            <button
              onClick={() => setModalOpen('portManager', false)}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Capacity Summary Metric Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 p-4 bg-slate-50 border-b border-slate-200 text-center text-xs">
          <div className="p-2.5 bg-white rounded-xl border border-slate-200 shadow-2xs">
            <div className="font-extrabold text-slate-900 text-base">{summary.total}</div>
            <div className="text-[11px] text-slate-500 font-semibold">Total PON Ports</div>
          </div>
          <div className="p-2.5 bg-emerald-50 rounded-xl border border-emerald-200 shadow-2xs">
            <div className="font-extrabold text-emerald-700 text-base">{summary.used}</div>
            <div className="text-[11px] text-emerald-800 font-semibold">In Use / Online</div>
          </div>
          <div className="p-2.5 bg-blue-50 rounded-xl border border-blue-200 shadow-2xs">
            <div className="font-extrabold text-blue-700 text-base">{summary.available}</div>
            <div className="text-[11px] text-blue-800 font-semibold">Available Sockets</div>
          </div>
          <div className="p-2.5 bg-amber-50 rounded-xl border border-amber-200 shadow-2xs">
            <div className="font-extrabold text-amber-700 text-base">{summary.reserved}</div>
            <div className="text-[11px] text-amber-800 font-semibold">Reserved Ports</div>
          </div>
          <div className="p-2.5 bg-rose-50 rounded-xl border border-rose-200 shadow-2xs">
            <div className="font-extrabold text-rose-700 text-base">{summary.damaged}</div>
            <div className="text-[11px] text-rose-800 font-semibold">Damaged / Faulty</div>
          </div>
          <div className="p-2.5 bg-indigo-50 rounded-xl border border-indigo-200 shadow-2xs">
            <div className="font-extrabold text-indigo-700 text-base">{summary.utilization}%</div>
            <div className="text-[11px] text-indigo-800 font-semibold">Port Utilization</div>
          </div>
        </div>

        {/* View Switcher & Filter Bar */}
        <div className="px-6 py-2.5 bg-white border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold">
            <button
              onClick={() => setViewTab('table')}
              className={`px-3 py-1 rounded-lg transition-colors flex items-center gap-1.5 ${
                viewTab === 'table' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Table className="w-3.5 h-3.5" />
              <span>Organized PON Table</span>
            </button>
            <button
              onClick={() => setViewTab('visual')}
              className={`px-3 py-1 rounded-lg transition-colors flex items-center gap-1.5 ${
                viewTab === 'visual' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Grid className="w-3.5 h-3.5" />
              <span>Chassis Port Matrix</span>
            </button>
          </div>

          {/* Filter by Technology */}
          {isOlt && (
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <span className="text-slate-500">Filter Standard:</span>
              {(['All', 'GPON', 'EPON'] as const).map((tech) => (
                <button
                  key={tech}
                  onClick={() => setFilterTech(tech)}
                  className={`px-2.5 py-0.5 rounded-lg text-xs transition-colors ${
                    filterTech === tech
                      ? 'bg-blue-600 text-white font-bold'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {tech}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Modal Main Content: Table or Visual Matrix on Left, Selected Port Details Dossier on Right */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column (2 Cols wide on desktop): Port Table or Matrix */}
          <div className="lg:col-span-2 space-y-4">
            {viewTab === 'table' ? (
              /* Organized Table Grid as specified in Section 5 */
              <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
                <div className="max-h-[50vh] overflow-y-auto">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead className="bg-slate-100 text-slate-700 uppercase font-extrabold text-[10px] tracking-wider sticky top-0 border-b border-slate-200 z-10">
                      <tr>
                        <th className="px-3.5 py-2.5">PON Port</th>
                        <th className="px-3 py-2.5">Technology</th>
                        <th className="px-3 py-2.5">Status</th>
                        <th className="px-3 py-2.5">Connected Feeder</th>
                        <th className="px-3 py-2.5">Splitter</th>
                        <th className="px-3 py-2.5 text-center">ONTs</th>
                        <th className="px-3 py-2.5 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium">
                      {filteredPorts.map((port) => {
                        const isSelected = selected?.id === port.id;
                        const statusStyle = PORT_STATUS_STYLE[port.status];

                        return (
                          <tr
                            key={port.id}
                            onClick={() => setSelectedPortId(port.id)}
                            className={`cursor-pointer transition-colors ${
                              isSelected ? 'bg-blue-50/80 font-bold' : 'hover:bg-slate-50'
                            }`}
                          >
                            <td className="px-3.5 py-2 font-mono font-bold text-slate-900 flex items-center gap-1.5">
                              <span className={`w-2 h-2 rounded-full ${statusStyle.fill}`} />
                              <span>{port.slotCardPort}</span>
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  port.technology === 'GPON'
                                    ? 'bg-blue-100 text-blue-800 border border-blue-200'
                                    : port.technology === 'EPON'
                                      ? 'bg-indigo-100 text-indigo-800 border border-indigo-200'
                                      : 'bg-purple-100 text-purple-800 border border-purple-200'
                                }`}
                              >
                                {port.technology}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={`px-2 py-0.5 rounded border text-[10px] font-semibold ${statusStyle.text}`}
                              >
                                {port.status}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-slate-600 truncate max-w-[120px]">
                              {port.connectedFeederName}
                            </td>
                            <td className="px-3 py-2 text-slate-600 truncate max-w-[130px]">
                              {port.connectedSplitterName}
                            </td>
                            <td className="px-3 py-2 text-center font-bold text-slate-800">
                              {port.connectedOnts > 0 ? `${port.connectedOnts} Homes` : '—'}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedPortId(port.id);
                                }}
                                className="px-2 py-1 bg-white hover:bg-blue-50 text-blue-700 rounded-md border border-slate-200 text-[10px] font-bold"
                              >
                                Details
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              /* Visual Chassis Port Matrix */
              <div className="bg-slate-900 rounded-2xl p-5 border border-slate-800 shadow-md space-y-4">
                <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
                  <span>19-INCH TELECOM RACK BLADE SLOTS</span>
                  <span>CLICK PORT FOR DETAILED DIAGNOSTICS</span>
                </div>
                <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                  {filteredPorts.map((port) => {
                    const isSelected = selected?.id === port.id;
                    const style = PORT_STATUS_STYLE[port.status];
                    return (
                      <button
                        key={port.id}
                        onClick={() => setSelectedPortId(port.id)}
                        className={`h-12 rounded-xl p-1.5 flex flex-col items-center justify-between transition-all border ${
                          isSelected
                            ? 'bg-blue-600 text-white border-blue-400 shadow-lg scale-105 ring-2 ring-blue-300'
                            : 'bg-slate-800 text-slate-200 hover:bg-slate-700 border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full text-[9px] font-bold font-mono">
                          <span>{port.slotCardPort}</span>
                          <span className={`w-2 h-2 rounded-full ${style.fill}`} />
                        </div>
                        <div className="text-[10px] font-extrabold uppercase">
                          {port.status === 'Used' ? 'ACTIVE' : port.status === 'Available' ? 'FREE' : port.status}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* GPON vs EPON Engineering Distinction Card */}
            {isOlt && (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2 text-xs">
                <div className="flex items-center gap-2 font-bold text-slate-800">
                  <Cpu className="w-4 h-4 text-blue-600" />
                  <span>Telecommunications Standards Reference: GPON vs EPON</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div className="p-3 bg-blue-50/70 border border-blue-200/80 rounded-xl space-y-1">
                    <div className="font-bold text-blue-900">ITU-T G.984 GPON Standard</div>
                    <div className="text-[11px] text-slate-700">
                      &bull; Downstream: 2.488 Gbps / Upstream: 1.244 Gbps
                    </div>
                    <div className="text-[11px] text-slate-700">&bull; Max Split: 1:128 (Typically 1:64 deployed)</div>
                    <div className="text-[11px] text-slate-700">
                      &bull; Framing: GEM (GPON Encapsulation Method, 93% efficient)
                    </div>
                  </div>
                  <div className="p-3 bg-indigo-50/70 border border-indigo-200/80 rounded-xl space-y-1">
                    <div className="font-bold text-indigo-900">IEEE 802.3ah EPON Standard</div>
                    <div className="text-[11px] text-slate-700">
                      &bull; Downstream: 1.25 Gbps / Upstream: 1.25 Gbps (Symmetric)
                    </div>
                    <div className="text-[11px] text-slate-700">&bull; Max Split: 1:64 (Typically 1:32 deployed)</div>
                    <div className="text-[11px] text-slate-700">
                      &bull; Framing: Native Ethernet 802.3 Frames (MPCP protocol)
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Selected PON Port Diagnostics Dossier */}
          {selected && (
            <div className="p-5 rounded-2xl border border-slate-200 bg-white shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Port Details</div>
                  <h3 className="text-base font-black text-slate-900 font-mono">
                    Port {selected.slotCardPort || selected.portNumber}
                  </h3>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-bold border ${PORT_STATUS_STYLE[selected.status].text}`}
                >
                  {selected.status}
                </span>
              </div>

              {/* Port Properties List */}
              <div className="space-y-2.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500 font-medium">Technology:</span>
                  <span className="font-bold text-slate-900">{selected.technology}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-medium">Connected Feeder:</span>
                  <span className="font-bold text-blue-700">{selected.connectedFeederName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-medium">Connected Splitter:</span>
                  <span className="font-semibold text-slate-800">{selected.connectedSplitterName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-medium">Subscribers / ONTs:</span>
                  <span className="font-bold text-emerald-700">{selected.connectedOnts} Connected</span>
                </div>
              </div>

              {/* Live Optical Power Telemetry Box */}
              <div className="p-3.5 bg-slate-900 text-white rounded-xl space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-1 font-bold text-sky-400">
                    <Radio className="w-3.5 h-3.5" /> Optical Power Telemetry
                  </span>
                  <span className="text-[10px] font-mono text-emerald-400">{selected.opticalStatus}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-center pt-1">
                  <div className="bg-slate-800 p-2 rounded-lg border border-slate-700">
                    <span className="text-[10px] text-slate-400 block font-semibold">Tx Power</span>
                    <span className="font-mono text-sm font-bold text-sky-400">+{selected.txPowerDbm} dBm</span>
                  </div>
                  <div className="bg-slate-800 p-2 rounded-lg border border-slate-700">
                    <span className="text-[10px] text-slate-400 block font-semibold">Rx Power</span>
                    <span className="font-mono text-sm font-bold text-emerald-400">{selected.rxPowerDbm} dBm</span>
                  </div>
                </div>
                <div className="text-[10px] text-slate-400 font-mono text-center">{selected.lastUpdated}</div>
              </div>

              {/* Status Action Buttons */}
              <div className="space-y-1.5 pt-2 border-t border-slate-100">
                <div className="text-[11px] font-bold text-slate-700 mb-1">Update Port Status:</div>
                <div className="grid grid-cols-2 gap-2">
                  {(['Available', 'Used', 'Reserved', 'Damaged'] as LogicalPortStatus[]).map((st) => (
                    <button
                      key={st}
                      onClick={() => changeStatus(st)}
                      className={`py-2 rounded-xl border text-xs font-bold transition-all ${
                        selected.status === st
                          ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                          : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
                      }`}
                    >
                      {st === 'Used' ? 'Assign (In Use)' : st === 'Available' ? 'Release (Free)' : st}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0 text-xs text-slate-500">
          <div>Verified against ITU-T G.984 and IEEE 802.3ah telecommunication specifications.</div>
          <button
            onClick={() => setModalOpen('portManager', false)}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl text-xs transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
