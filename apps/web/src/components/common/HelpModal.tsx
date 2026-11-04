import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useUiStore } from '../../stores/uiStore';
import { STANDARD_12_COLORS } from '@fibergis/shared';
import { X, BookOpen, Map, ShieldCheck } from 'lucide-react';

export const HelpModal: React.FC = () => {
  const { isHelpModalOpen, setModalOpen } = useUiStore(
    useShallow((s) => ({ isHelpModalOpen: s.modals.help, setModalOpen: s.setModalOpen })),
  );

  if (!isHelpModalOpen) return null;

  return (
    <div className="fixed inset-0 z-[1000] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in select-none">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-xs">
              <BookOpen className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-sm text-slate-900">FIBER-GIS Platform Guide & Quick Reference</h2>
              <p className="text-[11px] text-slate-500">
                Telecom engineering best practices, keyboard shortcuts & optical standards
              </p>
            </div>
          </div>
          <button
            onClick={() => setModalOpen('help', false)}
            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
          {/* Section 1: 5-Minute Quick Start */}
          <div className="p-4 bg-blue-50/70 rounded-2xl border border-blue-200 space-y-2">
            <div className="font-bold text-xs text-blue-950 flex items-center gap-1.5">
              <Map className="w-4 h-4 text-blue-600" />
              <span>5-Step Beginner Workflow to Map a Network</span>
            </div>
            <ol className="list-decimal pl-5 space-y-1 text-blue-900 text-[11px] leading-relaxed">
              <li>
                <strong>Select or Place Equipment:</strong> Drag an OLT, FDMS, or FAT from the left Component Library
                onto the GIS map or click to place.
              </li>
              <li>
                <strong>Draw Cable Route:</strong> Click "Draw Cable" or choose a cable type. Click waypoints on the
                map; it automatically snaps to poles and equipment.
              </li>
              <li>
                <strong>Upload & Annotate Photos:</strong> Select any FAT terminal box, click "Open Box & Photo
                Annotator" to mark individual ports non-destructively.
              </li>
              <li>
                <strong>Check Available Leads:</strong> Open the bottom Information Panel to review the 12-color fiber
                code and verify free leads.
              </li>
              <li>
                <strong>Connect Subscribers:</strong> Launch the "Connect Customer" wizard to allocate an available
                splitter port and provision the FTTH drop path.
              </li>
            </ol>
          </div>

          {/* Section 2: Standard 12-Color Fiber Sequence */}
          <div className="space-y-2">
            <div className="font-bold text-xs text-slate-900">
              Standard 12-Color Optical Fiber Identification (TIA/EIA-598)
            </div>
            <div className="grid grid-cols-6 gap-2">
              {STANDARD_12_COLORS.map((c) => (
                <div key={c.number} className="p-2 rounded-xl bg-slate-50 border border-slate-200 text-center">
                  <div
                    className="w-5 h-5 rounded-full mx-auto mb-1 border border-black/20 shadow-xs"
                    style={{ backgroundColor: c.hex }}
                  />
                  <div className="font-mono font-bold text-[10px] text-slate-800">
                    #{c.number.toString().padStart(2, '0')}
                  </div>
                  <div className="font-semibold text-[10px] text-slate-600 truncate">{c.name}</div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 italic">
              Sequence repeats for higher core counts (24, 48, 96, 144, 288) inside numbered color-coded buffer tubes.
            </p>
          </div>

          {/* Section 3: Splitter Ratios & Theoretical Insertion Losses */}
          <div className="space-y-2">
            <div className="font-bold text-xs text-slate-900">PLC Optical Splitter Ratios & Insertion Loss Specs</div>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                <div className="font-bold text-xs text-slate-800">1:4 Splitter</div>
                <div className="text-[10px] text-purple-700 font-bold mt-0.5">~7.2 dB loss</div>
                <div className="text-[9px] text-slate-500">Distribution Hubs</div>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                <div className="font-bold text-xs text-slate-800">1:8 Splitter</div>
                <div className="text-[10px] text-purple-700 font-bold mt-0.5">~10.3 dB loss</div>
                <div className="text-[9px] text-slate-500">Standard FAT Drop</div>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                <div className="font-bold text-xs text-slate-800">1:16 Splitter</div>
                <div className="text-[10px] text-purple-700 font-bold mt-0.5">~13.8 dB loss</div>
                <div className="text-[9px] text-slate-500">High Density Riser</div>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                <div className="font-bold text-xs text-slate-800">1:32 Splitter</div>
                <div className="text-[10px] text-purple-700 font-bold mt-0.5">~17.1 dB loss</div>
                <div className="text-[9px] text-slate-500">Single-Stage PON</div>
              </div>
            </div>
          </div>

          {/* Section 4: Built-in Safeguards & Validation */}
          <div className="p-4 bg-emerald-50/60 rounded-2xl border border-emerald-200 space-y-1.5 text-emerald-950">
            <div className="font-bold text-xs flex items-center gap-1.5 text-emerald-900">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Engineered Error Prevention & Validation Safeguards</span>
            </div>
            <ul className="list-disc pl-5 space-y-1 text-[11px] text-emerald-900 leading-normal">
              <li>
                <strong>Duplicate ID Block:</strong> Ensures every equipment and cable ID is strictly unique.
              </li>
              <li>
                <strong>Physical Port Double-Booking Prevention:</strong> Prevents two active drop connections from
                claiming the same splitter output port.
              </li>
              <li>
                <strong>Core Lead Protection:</strong> Automatically flags occupied cores and prevents duplicate core
                assignments.
              </li>
              <li>
                <strong>Non-Destructive Photos:</strong> Keeps field photographs pristine; all annotation pins and
                circles are stored separately as vector layers.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
