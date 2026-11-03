import React, { useState } from 'react';
import { useNetwork } from '../../context/NetworkContext';
import { CORE_STATUS_COLORS } from '../../constants/colorStandards';
import {
  X,
  ChevronDown,
  ChevronUp,
  Layers,
  Activity,
  History,
  Grid,
  Filter,
  CheckCircle,
  AlertCircle,
  Check,
  Plus
} from 'lucide-react';

export const BottomInfoPanel: React.FC = () => {
  const {
    cables,
    selectedObject,
    isBottomPanelOpen,
    setIsBottomPanelOpen,
    activeTracePath,
    clearTrace,
    auditLogs,
    allocateFiberCore,
    showToast
  } = useNetwork();

  const [activeTab, setActiveTab] = useState<'cores' | 'trace' | 'audit'>('cores');
  const [coreStatusFilter, setCoreStatusFilter] = useState<string>('All');

  if (!isBottomPanelOpen) {
    return (
      <button
        onClick={() => setIsBottomPanelOpen(true)}
        className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 bg-white/95 backdrop-blur-md border border-slate-200 rounded-full px-4 py-1.5 shadow-lg hover:bg-slate-50 transition-all text-xs font-semibold text-slate-700 flex items-center gap-2"
        title="Open Bottom Information Panel"
      >
        <Layers className="w-3.5 h-3.5 text-blue-600" />
        <span>Fiber Cores & Connection Table</span>
        <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
      </button>
    );
  }

  // Selected cable or fallback to first cable
  const currentCable = (selectedObject?.type === 'cable' ? selectedObject.data : null) || cables[0];

  const filteredCores = (currentCable?.cores || []).filter((core: any) => {
    if (coreStatusFilter === 'All') return true;
    return core.status === coreStatusFilter;
  });

  return (
    <div className="h-64 bg-white/95 backdrop-blur-md border-t border-slate-200/80 flex flex-col z-20 shrink-0 select-none shadow-xl transition-all duration-200">
      {/* Top Header Bar */}
      <div className="h-10 px-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-bold text-xs text-slate-800">
            <Layers className="w-4 h-4 text-blue-600" />
            <span>Cable Details: {currentCable?.name} ({currentCable?.id})</span>
          </div>

          {/* Tab Switcher */}
          <div className="flex items-center bg-slate-200/70 p-0.5 rounded-lg text-xs">
            <button
              onClick={() => setActiveTab('cores')}
              className={`px-2.5 py-0.5 rounded-md font-medium transition-all ${
                activeTab === 'cores' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Fiber Cores ({currentCable?.fiberCount}F)
            </button>
            <button
              onClick={() => setActiveTab('trace')}
              className={`px-2.5 py-0.5 rounded-md font-medium transition-all ${
                activeTab === 'trace' ? 'bg-white text-emerald-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Route Trace {activeTracePath ? `(${activeTracePath.length} hops)` : ''}
            </button>
            <button
              onClick={() => setActiveTab('audit')}
              className={`px-2.5 py-0.5 rounded-md font-medium transition-all ${
                activeTab === 'audit' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Activity Logs
            </button>
          </div>
        </div>

        {/* Right tools & Close */}
        <div className="flex items-center gap-2">
          {activeTab === 'cores' && (
            <div className="flex items-center gap-1 text-xs">
              <span className="text-[11px] text-slate-400 font-medium mr-1">Filter:</span>
              {['All', 'Available', 'In Use', 'Reserved', 'Damaged'].map(st => (
                <button
                  key={st}
                  onClick={() => setCoreStatusFilter(st)}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                    coreStatusFilter === st ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={() => setIsBottomPanelOpen(false)}
            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
            title="Minimize Panel"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tab Body */}
      <div className="flex-1 overflow-y-auto">
        {/* TAB 1: FIBER CORES TABLE */}
        {activeTab === 'cores' && (
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-slate-100/80 sticky top-0 border-b border-slate-200 text-slate-600 text-[11px] uppercase tracking-wider font-semibold z-10">
              <tr>
                <th className="py-2 px-3">Core #</th>
                <th className="py-2 px-3">Color Code</th>
                <th className="py-2 px-3">Tube #</th>
                <th className="py-2 px-3">Operational Status</th>
                <th className="py-2 px-3">Connected Asset / Customer</th>
                <th className="py-2 px-3">Attenuation (dB)</th>
                <th className="py-2 px-3">Remarks / Route Notes</th>
                <th className="py-2 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {filteredCores.map((core: any) => {
                const statusDef = (CORE_STATUS_COLORS as any)[core.status] || CORE_STATUS_COLORS.Available;
                return (
                  <tr key={core.coreNumber} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2 px-3 font-mono font-bold text-slate-900">
                      {core.coreNumber.toString().padStart(2, '0')}
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-3.5 h-3.5 rounded-full border border-black/20 shadow-xs"
                          style={{ backgroundColor: core.colorHex }}
                        />
                        <span className="font-semibold text-slate-800">{core.colorName}</span>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-slate-500 font-mono text-[11px]">
                      Tube {core.tubeNumber}
                    </td>
                    <td className="py-2 px-3">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border ${statusDef.bg}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${statusDef.dot}`}></span>
                        {core.status}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-medium">
                      {core.connectedToEquipmentName || core.connectedToEquipmentId || core.customerId || (
                        <span className="text-slate-400 italic">— Free Lead —</span>
                      )}
                    </td>
                    <td className="py-2 px-3 font-mono text-slate-600">
                      {core.attenuationDb !== undefined ? `${core.attenuationDb} dB` : '—'}
                    </td>
                    <td className="py-2 px-3 text-slate-500 text-[11px] truncate max-w-xs">
                      {core.remarks}
                    </td>
                    <td className="py-2 px-3 text-right">
                      {core.status === 'Available' ? (
                        <button
                          onClick={() => allocateFiberCore(currentCable.id, core.coreNumber, undefined, 'FAT-01', 'PORT-AUTO')}
                          className="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-[10px] font-bold border border-blue-200 transition-colors"
                        >
                          Allocate
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-400 font-medium">In Service</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* TAB 2: ACTIVE FIBER ROUTE TRACE */}
        {activeTab === 'trace' && (
          <div className="p-4">
            {activeTracePath ? (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="font-bold text-xs text-slate-800">
                    Active End-to-End Trace Sequence ({activeTracePath.length} Nodes)
                  </span>
                  <button
                    onClick={clearTrace}
                    className="px-2 py-1 text-slate-500 hover:text-slate-800 text-xs font-semibold rounded hover:bg-slate-100"
                  >
                    Clear Active Trace
                  </button>
                </div>

                {/* Horizontal flow breadcrumbs */}
                <div className="flex items-center gap-2 overflow-x-auto pb-2">
                  {activeTracePath.map((hop, idx) => (
                    <React.Fragment key={`${hop.id}-${idx}`}>
                      <div className={`p-2.5 rounded-xl border shrink-0 text-center min-w-[130px] ${
                        hop.status === 'Faulty'
                          ? 'bg-rose-50 border-rose-300 text-rose-900 animate-pulse'
                          : 'bg-slate-50 border-slate-200 text-slate-800'
                      }`}>
                        <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{hop.type}</div>
                        <div className="font-bold text-xs leading-tight my-0.5">{hop.name}</div>
                        <div className="text-[10px] text-slate-500">{hop.details}</div>
                      </div>
                      {idx < activeTracePath.length - 1 && (
                        <div className="text-slate-400 font-bold shrink-0">&rarr;</div>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-slate-400">
                <Activity className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                <div className="text-xs font-medium">No Active Route Trace</div>
                <p className="text-[11px] text-slate-500 max-w-sm mx-auto mt-1">
                  Select any customer or equipment and click "Trace End-to-End OLT Path" to visualize the complete optical route with distance and telemetry.
                </p>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: AUDIT & ACTIVITY LOGS */}
        {activeTab === 'audit' && (
          <div className="p-3 divide-y divide-slate-100">
            {auditLogs.map(log => (
              <div key={log.id} className="py-2 flex items-center justify-between text-xs">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[10px] text-slate-400">{log.timestamp}</span>
                  <span className="font-semibold text-blue-700">{log.user} ({log.role})</span>
                  <span className="text-slate-800">{log.details}</span>
                </div>
                <span className="font-mono text-[10px] bg-slate-100 px-2 py-0.5 rounded text-slate-600">
                  {log.action}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
