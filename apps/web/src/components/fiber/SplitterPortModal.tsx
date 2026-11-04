import React, { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useNetworkStore } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';
import { X, Split } from 'lucide-react';

export const SplitterPortModal: React.FC = () => {
  const { isSplitterModalOpen, setModalOpen } = useUiStore(
    useShallow((s) => ({ isSplitterModalOpen: s.modals.splitter, setModalOpen: s.setModalOpen })),
  );
  const splitters = useNetworkStore((s) => s.splitters);

  const [selectedSplitterId, setSelectedSplitterId] = useState<string>(splitters[0]?.id || 'SP-01');
  const [selectedPortDetail, setSelectedPortDetail] = useState<any | null>(null);

  if (!isSplitterModalOpen) return null;

  const currentSplitter = splitters.find((s) => s.id === selectedSplitterId) || splitters[0];

  return (
    <div className="fixed inset-0 z-[1000] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in select-none">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-purple-600 text-white flex items-center justify-center shadow-xs">
              <Split className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-sm text-slate-900">Fiber Splitter & Port Matrix</h2>
              <p className="text-[11px] text-slate-500">Optical PLC Splitters & Physical Output Port Allocation</p>
            </div>
          </div>
          <button
            onClick={() => setModalOpen('splitter', false)}
            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Splitter Picker Strip */}
        <div className="px-6 py-2.5 border-b border-slate-100 bg-slate-100/50 flex items-center gap-2 overflow-x-auto">
          {splitters.map((sp) => (
            <button
              key={sp.id}
              onClick={() => {
                setSelectedSplitterId(sp.id);
                setSelectedPortDetail(null);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                selectedSplitterId === sp.id
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {sp.name} ({sp.ratio})
            </button>
          ))}
        </div>

        {/* Main Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
          {/* Splitter Specs Summary */}
          <div className="p-4 bg-purple-50/60 rounded-xl border border-purple-200 flex items-center justify-between">
            <div>
              <div className="font-bold text-sm text-purple-900">{currentSplitter.name}</div>
              <div className="text-[11px] text-purple-800 mt-0.5">
                Terminal Box: <span className="font-semibold">{currentSplitter.terminalBoxId}</span> &bull; Optical
                Loss: <span className="font-semibold">{currentSplitter.insertionLossDb} dB</span>
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono text-xs font-bold text-purple-700">
                Input Port: {currentSplitter.inputPort.id}
              </div>
              <div className="text-[11px] text-purple-600">
                Signal: {currentSplitter.inputPort.signalLevelDbm || -14.2} dBm
              </div>
            </div>
          </div>

          {/* Visual Schematic Diagram */}
          <div className="p-4 bg-slate-900 rounded-2xl text-white">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">
              Passive Optical Splitter Schematic ({currentSplitter.ratio})
            </div>

            <div className="flex items-center gap-6">
              {/* Input side */}
              <div className="flex flex-col items-center">
                <div className="px-3 py-1.5 bg-blue-600 text-white font-mono font-bold text-xs rounded-lg shadow-sm border border-blue-400">
                  {currentSplitter.inputPort.id}
                </div>
                <div className="text-[10px] text-slate-400 mt-1">Input Fiber</div>
              </div>

              {/* Central Splitter Prism */}
              <div className="px-4 py-6 bg-slate-800 border border-purple-500/50 rounded-xl flex flex-col items-center justify-center text-center">
                <div className="font-bold text-xs text-purple-300">PLC {currentSplitter.ratio}</div>
                <div className="text-[10px] text-slate-400">Insertion Loss: {currentSplitter.insertionLossDb} dB</div>
              </div>

              {/* Output Pins */}
              <div className="flex-1 grid grid-cols-4 sm:grid-cols-8 gap-1.5">
                {currentSplitter.outputPorts.map((port) => {
                  const isAvailable = port.status === 'Available';
                  const isOccupied = port.status === 'Occupied';
                  const isSelected = selectedPortDetail?.portNumber === port.portNumber;
                  return (
                    <button
                      key={port.portNumber}
                      onClick={() => setSelectedPortDetail(port)}
                      className={`p-2 rounded-lg text-center transition-all ${
                        isSelected ? 'ring-2 ring-white scale-105 shadow-md' : ''
                      } ${
                        isAvailable
                          ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                          : isOccupied
                            ? 'bg-blue-600 hover:bg-blue-500 text-white'
                            : 'bg-rose-600 text-white'
                      }`}
                    >
                      <div className="font-mono font-bold text-[11px]">{port.portNumber}</div>
                      <div className="text-[8px] opacity-80 truncate">{port.status.slice(0, 4)}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Selected Port Inspector Details */}
          {selectedPortDetail && (
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 animate-in fade-in space-y-2">
              <div className="flex items-center justify-between border-b pb-1.5">
                <span className="font-bold text-xs text-slate-800">
                  Port #{selectedPortDetail.portNumber} ({selectedPortDetail.label}) Details
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    selectedPortDetail.status === 'Available'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-blue-100 text-blue-800'
                  }`}
                >
                  {selectedPortDetail.status}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-slate-500">Connected Customer:</span>{' '}
                  <span className="font-semibold text-slate-800">
                    {selectedPortDetail.connectedCustomerName ||
                      selectedPortDetail.connectedCustomerId ||
                      'None (Free Lead)'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Connected Drop Cable:</span>{' '}
                  <span className="font-mono text-slate-800">{selectedPortDetail.connectedDropCableId || 'None'}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
