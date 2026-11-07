import React from 'react';
import { BarChart3, Cable, Percent, Split, Users, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { useNetworkStore } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';

export const CapacityDashboardModal: React.FC = () => {
  const { isCapacityDashboardOpen, setModalOpen } = useUiStore(
    useShallow((s) => ({ isCapacityDashboardOpen: s.modals.capacityDashboard, setModalOpen: s.setModalOpen })),
  );
  const { cables, customers, splitters, faults, equipments, closures } = useNetworkStore(
    useShallow((s) => ({
      cables: s.cables,
      customers: s.customers,
      splitters: s.splitters,
      faults: s.faults,
      equipments: s.equipment,
      closures: s.closures,
    })),
  );

  if (!isCapacityDashboardOpen) return null;

  // Aggregate statistics
  const totalLengthMeters = cables.reduce((acc, c) => acc + c.lengthMeters, 0);
  const totalCores = cables.reduce((acc, c) => acc + c.fiberCount, 0);
  const usedCores = cables.reduce((acc, c) => acc + c.cores.filter((core) => core.status === 'In Use').length, 0);
  const availableCores = cables.reduce(
    (acc, c) => acc + c.cores.filter((core) => core.status === 'Available').length,
    0,
  );
  const reservedCores = cables.reduce((acc, c) => acc + c.cores.filter((core) => core.status === 'Reserved').length, 0);
  const damagedCores = cables.reduce((acc, c) => acc + c.cores.filter((core) => core.status === 'Damaged').length, 0);

  const coreUtilizationPct = totalCores > 0 ? Math.round((usedCores / totalCores) * 100) : 0;
  const pct = (n: number) => (totalCores > 0 ? (n / totalCores) * 100 : 0);
  const count = (test: (e: (typeof equipments)[number]) => boolean) => equipments.filter(test).length;

  const totalSplitterPorts = splitters.reduce((acc, s) => acc + s.outputPorts.length, 0);
  const usedSplitterPorts = splitters.reduce(
    (acc, s) => acc + s.outputPorts.filter((p) => p.status === 'Occupied').length,
    0,
  );
  const splitterUtilizationPct =
    totalSplitterPorts > 0 ? Math.round((usedSplitterPorts / totalSplitterPorts) * 100) : 0;

  return (
    <div className="modal-sheet fixed inset-0 z-[1000] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in select-none">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shadow-xs">
              <BarChart3 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-sm text-slate-900">Network Capacity & Infrastructure Analytics</h2>
              <p className="text-[11px] text-slate-500">
                Counts from saved records. No live connection.
              </p>
            </div>
          </div>
          <button
            onClick={() => setModalOpen('capacityDashboard', false)}
            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Dashboard KPIs Grid */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
          {/* Top 4 Metric Cards */}
          <div className="grid grid-cols-4 gap-4">
            <div className="p-4 bg-blue-50/60 rounded-2xl border border-blue-200/80">
              <div className="flex items-center justify-between text-blue-700 mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider">Total Fiber Route</span>
                <Cable className="w-4 h-4" />
              </div>
              <div className="font-extrabold text-xl text-blue-950">{(totalLengthMeters / 1000).toFixed(2)} km</div>
              <div className="text-[10px] text-blue-600 mt-0.5">{cables.length} mapped cable spans</div>
            </div>

            <div className="p-4 bg-emerald-50/60 rounded-2xl border border-emerald-200/80">
              <div className="flex items-center justify-between text-emerald-700 mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider">Active Subscribers</span>
                <Users className="w-4 h-4" />
              </div>
              <div className="font-extrabold text-xl text-emerald-950">{customers.length} customers</div>
              <div className="text-[10px] text-emerald-600 mt-0.5">
                {customers.filter((c) => !!c.oltId).length} of {customers.length} linked to an OLT
              </div>
            </div>

            <div className="p-4 bg-purple-50/60 rounded-2xl border border-purple-200/80">
              <div className="flex items-center justify-between text-purple-700 mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider">Splitter Port Load</span>
                <Split className="w-4 h-4" />
              </div>
              <div className="font-extrabold text-xl text-purple-950">{splitterUtilizationPct}% Used</div>
              <div className="text-[10px] text-purple-600 mt-0.5">
                {usedSplitterPorts} / {totalSplitterPorts} ports occupied
              </div>
            </div>

            <div className="p-4 bg-amber-50/60 rounded-2xl border border-amber-200/80">
              <div className="flex items-center justify-between text-amber-700 mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider">Core Utilization</span>
                <Percent className="w-4 h-4" />
              </div>
              <div className="font-extrabold text-xl text-amber-950">{coreUtilizationPct}% In Use</div>
              <div className="text-[10px] text-amber-600 mt-0.5">{availableCores} free leads available</div>
            </div>
          </div>

          {/* Fiber Core Breakdown Chart */}
          <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-xs text-slate-900">
                Total Network Optical Cores ({totalCores} Total Cores)
              </span>
              <span className="text-[11px] font-bold text-blue-700">{coreUtilizationPct}% Utilized</span>
            </div>

            <div className="w-full h-4 bg-slate-200 rounded-full overflow-hidden flex border border-slate-300">
              <div
                className="bg-blue-600 h-full"
                style={{ width: `${pct(usedCores)}%` }}
                title="In Use"
              />
              <div
                className="bg-amber-500 h-full"
                style={{ width: `${pct(reservedCores)}%` }}
                title="Reserved"
              />
              <div
                className="bg-rose-500 h-full"
                style={{ width: `${pct(damagedCores)}%` }}
                title="Damaged"
              />
              <div
                className="bg-emerald-500 h-full"
                style={{ width: `${pct(availableCores)}%` }}
                title="Available"
              />
            </div>

            <div className="grid grid-cols-4 gap-3 text-center text-xs pt-1">
              <div className="p-2 bg-white rounded-xl border border-slate-200">
                <div className="text-blue-700 font-bold">{usedCores} Cores</div>
                <div className="text-[10px] text-slate-500">Active In Service</div>
              </div>
              <div className="p-2 bg-white rounded-xl border border-slate-200">
                <div className="text-emerald-700 font-bold">{availableCores} Cores</div>
                <div className="text-[10px] text-slate-500">Free for Provisioning</div>
              </div>
              <div className="p-2 bg-white rounded-xl border border-slate-200">
                <div className="text-amber-700 font-bold">{reservedCores} Cores</div>
                <div className="text-[10px] text-slate-500">Lease Reserved</div>
              </div>
              <div className="p-2 bg-white rounded-xl border border-slate-200">
                <div className="text-rose-700 font-bold">{damagedCores} Cores</div>
                <div className="text-[10px] text-slate-500">Attenuation Damaged</div>
              </div>
            </div>
          </div>

          {/* Infrastructure Distribution Table */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
              <div className="font-bold text-xs text-slate-900 border-b pb-1.5">Central Office & Distribution Hubs</div>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span>OLTs:</span> <span className="font-bold">{count((e) => e.type === 'OLT')}</span>
                </div>
                <div className="flex justify-between">
                  <span>ODFs:</span> <span className="font-bold">{count((e) => e.type === 'ODF')}</span>
                </div>
                <div className="flex justify-between">
                  <span>FDMS Street Cabinets:</span> <span className="font-bold">{count((e) => e.type === 'FDMS')}</span>
                </div>
                <div className="flex justify-between">
                  <span>FDT Distribution Points:</span> <span className="font-bold">{count((e) => e.type === 'FDT')}</span>
                </div>
                <div className="flex justify-between">
                  <span>Terminal Boxes:</span>{' '}
                  <span className="font-bold">{count((e) => e.type === 'FAT' || e.type.includes('Terminal Box'))}</span>
                </div>
                <div className="flex justify-between">
                  <span>Joint Closures:</span> <span className="font-bold">{closures.length}</span>
                </div>
              </div>
            </div>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
              <div className="font-bold text-xs text-slate-900 border-b pb-1.5">Supporting Assets & Cable TV</div>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span>Poles:</span> <span className="font-bold">{count((e) => e.type.includes('Pole'))}</span>
                </div>
                <div className="flex justify-between">
                  <span>Manholes and chambers:</span>{' '}
                  <span className="font-bold">{count((e) => /Manhole|Chamber/i.test(e.type))}</span>
                </div>
                <div className="flex justify-between">
                  <span>CATV Optical Nodes:</span> <span className="font-bold">{count((e) => e.type === 'CATV Optical Node')}</span>
                </div>
                <div className="flex justify-between">
                  <span>CATV RF Amplifiers:</span>{' '}
                  <span className="font-bold">{count((e) => /Amplifier/i.test(e.type))}</span>
                </div>
                <div className="flex justify-between">
                  <span>Coaxial cables:</span>{' '}
                  <span className="font-bold">{cables.filter((c) => c.cableCategory === 'Coaxial').length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Active Network Faults:</span>{' '}
                  <span className="font-bold text-rose-600">
                    {faults.filter((f) => f.status !== 'Resolved').length} active
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
