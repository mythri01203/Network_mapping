import React, { useState } from 'react';
import { addSplice, removeSplice } from '../../stores/networkActions';
import { useShallow } from 'zustand/react/shallow';
import { useToastStore } from '../../stores/toastStore';
import { useNetworkStore } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';
import { type SpliceRecord, getFiberColor } from '@fibergis/shared';
import { X, GitBranch, Trash2, Zap } from 'lucide-react';

export const SplicingModal: React.FC = () => {
  const { isSplicingModalOpen, setModalOpen } = useUiStore(
    useShallow((s) => ({ isSplicingModalOpen: s.modals.splicing, setModalOpen: s.setModalOpen })),
  );
  const { closures, cables } = useNetworkStore(useShallow((s) => ({ closures: s.closures, cables: s.cables })));
  const showToast = useToastStore((s) => s.show);

  const [selectedClosureId, setSelectedClosureId] = useState<string>(closures[0]?.id || 'JC-01');

  // New splice input state
  const [newInCableId, setNewInCableId] = useState<string>(cables[0]?.id || '');
  const [newInCore, setNewInCore] = useState<number>(1);
  const [newOutCableId, setNewOutCableId] = useState<string>(cables[1]?.id || '');
  const [newOutCore, setNewOutCore] = useState<number>(1);
  const [newLossDb, setNewLossDb] = useState<number>(0.02);
  const [newStatus, setNewStatus] = useState<SpliceRecord['status']>('Spliced');
  const [newTray, setNewTray] = useState<string>('Tray 1 (Primary Feeder)');
  const [newTechnician, setNewTechnician] = useState<string>('Arun Varma (Lead Splicer)');

  if (!isSplicingModalOpen) return null;

  const currentClosure = closures.find((c) => c.id === selectedClosureId) || closures[0];

  const inCoreColor = getFiberColor(newInCore);
  const outCoreColor = getFiberColor(newOutCore);

  const handleAddSplice = () => {
    // Check self-splice conflict
    if (newInCableId === newOutCableId && newInCore === newOutCore) {
      showToast('error', 'Invalid Splice', 'Cannot splice a fiber core to itself.');
      return;
    }

    // Validation: prevent duplicate core endpoint within this closure
    const isDuplicate = currentClosure.splices.some(
      (s) =>
        (s.inputCableId === newInCableId && s.inputCore === newInCore) ||
        (s.outputCableId === newInCableId && s.outputCore === newInCore) ||
        (s.inputCableId === newOutCableId && s.inputCore === newOutCore) ||
        (s.outputCableId === newOutCableId && s.outputCore === newOutCore),
    );

    if (isDuplicate) {
      showToast(
        'error',
        'Duplicate Core Endpoint',
        `A core endpoint is already assigned in closure ${currentClosure.id}. Within the same closure, each core endpoint can only be spliced once.`,
      );
      return;
    }

    const inCable = cables.find((c) => c.id === newInCableId);
    const outCable = cables.find((c) => c.id === newOutCableId);

    const newSplice: SpliceRecord = {
      id: `SPL-${Date.now().toString().slice(-4)}`,
      inputCableId: newInCableId,
      inputCableName: inCable?.name || newInCableId,
      inputCore: newInCore,
      outputCableId: newOutCableId,
      outputCableName: outCable?.name || newOutCableId,
      outputCore: newOutCore,
      spliceLossDb: newLossDb,
      status: newStatus,
      technician: newTechnician,
      date: new Date().toISOString().split('T')[0],
    };

    const success = addSplice(currentClosure.id, newSplice);
    if (success) {
      setNewInCore((prev) => prev + 1);
      setNewOutCore((prev) => prev + 1);
    }
  };

  const handleDeleteSplice = (spliceId: string) => {
    if (window.confirm('Delete this fiber core fusion splice mapping?')) {
      removeSplice(currentClosure.id, spliceId);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in select-none">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-600 text-white flex items-center justify-center shadow-xs">
              <GitBranch className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-sm text-slate-900">Fiber Splicing & Joint Closure Manager</h2>
              <p className="text-[11px] text-slate-500">
                Optical Core-to-Core Fusion Splicing Matrix · TIA-598 Color Standards
              </p>
            </div>
          </div>
          <button
            onClick={() => setModalOpen('splicing', false)}
            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Closure Picker Strip */}
        <div className="px-6 py-2.5 border-b border-slate-100 bg-slate-100/50 flex items-center gap-2 overflow-x-auto">
          {closures.map((jc) => (
            <button
              key={jc.id}
              onClick={() => setSelectedClosureId(jc.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                selectedClosureId === jc.id
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {jc.name} ({jc.id})
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
          {/* Closure Specs */}
          <div className="p-4 bg-amber-50/70 rounded-xl border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-xs bg-amber-200/80 text-amber-900 px-2 py-0.5 rounded">
                  {currentClosure.id}
                </span>
                <span className="font-bold text-sm text-amber-950">{currentClosure.name}</span>
              </div>
              <div className="text-[11px] text-amber-900 mt-1 flex flex-wrap gap-x-3">
                <span>
                  Type: <strong>{currentClosure.closureType}</strong>
                </span>
                <span>
                  Area: <strong>{currentClosure.area}</strong>
                </span>
                <span>
                  Certified Lead: <strong>{currentClosure.technician}</strong>
                </span>
              </div>
            </div>
            <div className="text-right">
              <span className="font-bold text-amber-800 bg-amber-100 px-3 py-1 rounded-lg border border-amber-300">
                {currentClosure.splices.length} Active Splices
              </span>
            </div>
          </div>

          {/* New Splice Form */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-xs text-slate-800">Add Core-to-Core Fusion Splice</span>
              <span className="text-[10px] text-slate-500">TIA-598 Color Identification Active</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-6 gap-2.5 items-end">
              {/* Input Cable */}
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Incoming Cable</label>
                <select
                  value={newInCableId}
                  onChange={(e) => setNewInCableId(e.target.value)}
                  className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
                >
                  {cables.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.id} ({c.fiberCount}F)
                    </option>
                  ))}
                </select>
              </div>

              {/* Input Core # with Color Swatch */}
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">
                  In Core ({inCoreColor.name})
                </label>
                <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2 py-1">
                  <span
                    className="w-3.5 h-3.5 rounded-full border border-slate-400 shrink-0"
                    style={{ backgroundColor: inCoreColor.hex }}
                  />
                  <input
                    type="number"
                    min="1"
                    max="96"
                    value={newInCore}
                    onChange={(e) => setNewInCore(Number(e.target.value))}
                    className="w-full text-xs outline-none font-bold"
                  />
                </div>
              </div>

              {/* Output Cable */}
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Outgoing Cable</label>
                <select
                  value={newOutCableId}
                  onChange={(e) => setNewOutCableId(e.target.value)}
                  className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
                >
                  {cables.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.id} ({c.fiberCount}F)
                    </option>
                  ))}
                </select>
              </div>

              {/* Output Core # with Color Swatch */}
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">
                  Out Core ({outCoreColor.name})
                </label>
                <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2 py-1">
                  <span
                    className="w-3.5 h-3.5 rounded-full border border-slate-400 shrink-0"
                    style={{ backgroundColor: outCoreColor.hex }}
                  />
                  <input
                    type="number"
                    min="1"
                    max="96"
                    value={newOutCore}
                    onChange={(e) => setNewOutCore(Number(e.target.value))}
                    className="w-full text-xs outline-none font-bold"
                  />
                </div>
              </div>

              {/* Loss dB & Status */}
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">
                  Splice Loss (dB)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.00"
                  max="1.50"
                  value={newLossDb}
                  onChange={(e) => setNewLossDb(Number(e.target.value))}
                  className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono font-bold"
                />
              </div>

              <div>
                <button
                  type="button"
                  onClick={handleAddSplice}
                  className="w-full py-2 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-lg transition-colors flex items-center justify-center gap-1 shadow-xs"
                >
                  <Zap className="w-3.5 h-3.5" /> Fuse Splice
                </button>
              </div>
            </div>

            {/* Additional Metadata Fields: Tray, Status, Technician */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1 text-[11px]">
              <div>
                <label className="text-slate-500">Splice Tray Selection:</label>
                <select
                  value={newTray}
                  onChange={(e) => setNewTray(e.target.value)}
                  className="w-full px-2 py-1 bg-white border border-slate-200 rounded-md text-xs mt-0.5"
                >
                  <option value="Tray 1 (Primary Feeder)">Tray 1 (Primary Feeder)</option>
                  <option value="Tray 2 (Distribution Ring)">Tray 2 (Distribution Ring)</option>
                  <option value="Tray 3 (Local Drop Branches)">Tray 3 (Local Drop Branches)</option>
                  <option value="Tray 4 (Spare / Expansion)">Tray 4 (Spare / Expansion)</option>
                </select>
              </div>

              <div>
                <label className="text-slate-500">Splice Status:</label>
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value as any)}
                  className="w-full px-2 py-1 bg-white border border-slate-200 rounded-md text-xs mt-0.5"
                >
                  <option value="Spliced">Spliced (Active)</option>
                  <option value="Tested">Tested (OTDR Verified)</option>
                  <option value="Pending">Pending Fusion</option>
                  <option value="Failed">Failed (Requires Re-splice)</option>
                </select>
              </div>

              <div>
                <label className="text-slate-500">Certified Splicer:</label>
                <input
                  type="text"
                  value={newTechnician}
                  onChange={(e) => setNewTechnician(e.target.value)}
                  className="w-full px-2 py-1 bg-white border border-slate-200 rounded-md text-xs mt-0.5"
                />
              </div>
            </div>
          </div>

          {/* Splicing Table */}
          <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-600 font-semibold uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="py-2.5 px-3">Input Cable & Core</th>
                  <th className="py-2.5 px-3">Color</th>
                  <th className="py-2.5 px-3">Output Cable & Core</th>
                  <th className="py-2.5 px-3">Color</th>
                  <th className="py-2.5 px-3">Splice Loss</th>
                  <th className="py-2.5 px-3">Technician</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {currentClosure.splices.map((spl, i) => {
                  const inCol = getFiberColor(spl.inputCore);
                  const outCol = getFiberColor(spl.outputCore);
                  return (
                    <tr key={spl.id || i} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 font-semibold text-slate-800">
                        {spl.inputCableId} &bull; Core {spl.inputCore}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="flex items-center gap-1.5 text-[11px]">
                          <span
                            className="w-2.5 h-2.5 rounded-full border border-slate-300"
                            style={{ backgroundColor: inCol.hex }}
                          />
                          <span>{inCol.name}</span>
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-blue-700">
                        &rarr; {spl.outputCableId} &bull; Core {spl.outputCore}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="flex items-center gap-1.5 text-[11px]">
                          <span
                            className="w-2.5 h-2.5 rounded-full border border-slate-300"
                            style={{ backgroundColor: outCol.hex }}
                          />
                          <span>{outCol.name}</span>
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-emerald-600 font-bold">{spl.spliceLossDb} dB</td>
                      <td className="py-2.5 px-3 text-slate-600">{spl.technician}</td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            spl.status === 'Tested' || spl.status === 'Spliced'
                              ? 'bg-emerald-100 text-emerald-800'
                              : spl.status === 'Failed'
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {spl.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleDeleteSplice(spl.id)}
                          className="p-1 text-slate-400 hover:text-rose-600 transition-colors"
                          title="Delete Splice"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {currentClosure.splices.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400">
                      No splices recorded in this closure yet. Use the form above to add core fusion splices.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
