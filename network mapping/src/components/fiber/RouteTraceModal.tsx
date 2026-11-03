import React, { useState } from 'react';
import { useNetwork } from '../../context/NetworkContext';
import {
  X,
  Activity,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Search,
  ExternalLink,
  MapPin,
  ShieldCheck,
  Zap
} from 'lucide-react';

export const RouteTraceModal: React.FC = () => {
  const {
    isRouteTraceModalOpen,
    setIsRouteTraceModalOpen,
    activeTracePath,
    customers,
    equipments,
    cables,
    traceNetworkPath,
    flyToLocation
  } = useNetwork();

  const [searchTarget, setSearchTarget] = useState('');

  if (!isRouteTraceModalOpen) return null;

  const handleSearchTrace = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchTarget.trim()) return;

    // Search customers or equipment
    const cust = customers.find(c =>
      c.id.toLowerCase() === searchTarget.toLowerCase() ||
      c.name.toLowerCase().includes(searchTarget.toLowerCase()) ||
      c.ontSerialNumber.toLowerCase() === searchTarget.toLowerCase()
    );
    if (cust) {
      traceNetworkPath(cust.id);
      flyToLocation(cust.lat, cust.lng, 17);
      return;
    }

    const eq = equipments.find(e =>
      e.id.toLowerCase() === searchTarget.toLowerCase() ||
      e.name.toLowerCase().includes(searchTarget.toLowerCase())
    );
    if (eq) {
      traceNetworkPath(eq.id);
      flyToLocation(eq.lat, eq.lng, 17);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in select-none">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shadow-xs">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-sm text-slate-900">Advanced Optical Route Trace</h2>
              <p className="text-[11px] text-slate-500">End-to-End OLT to Customer ONT Physical & Logical Path</p>
            </div>
          </div>
          <button
            onClick={() => setIsRouteTraceModalOpen(false)}
            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Search Bar */}
        <div className="p-4 border-b border-slate-100 bg-slate-50/50">
          <form onSubmit={handleSearchTrace} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Trace by Customer ID (CUST-001), ONT Serial (HWTC-A981-01), or OLT..."
                value={searchTarget}
                onChange={e => setSearchTarget(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:border-blue-500 shadow-xs"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-xs transition-colors"
            >
              Trace Route
            </button>
          </form>

          {/* Quick Trace Buttons */}
          <div className="flex items-center gap-1.5 mt-2 overflow-x-auto text-[11px]">
            <span className="text-slate-400 font-semibold mr-1">Quick Trace:</span>
            {['CUST-001', 'CUST-004', 'CUST-009', 'CUST-013', 'CUST-022'].map(cid => (
              <button
                key={cid}
                onClick={() => { traceNetworkPath(cid); }}
                className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg font-mono text-blue-700 transition-colors"
              >
                {cid}
              </button>
            ))}
          </div>
        </div>

        {/* Trace Flow Sequence */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {activeTracePath ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-slate-800">
                  Calculated Optical Path ({activeTracePath.length} Nodes &bull; Cumulative Length: 1,045 meters)
                </span>
                <span className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full text-[10px] font-bold">
                  Rx Optical Power: -19.4 dBm (Pass)
                </span>
              </div>

              {/* Vertical Detailed Step Trace */}
              <div className="relative pl-6 space-y-4 before:absolute before:left-3 before:top-2 before:bottom-2 before:w-0.5 before:bg-gradient-to-b before:from-blue-600 before:via-emerald-500 before:to-blue-600">
                {activeTracePath.map((hop, idx) => {
                  const isFaulty = hop.status === 'Faulty';
                  return (
                    <div key={`${hop.id}-${idx}`} className="relative group">
                      <div className={`absolute -left-6 top-1.5 w-6 h-6 rounded-full border-2 border-white flex items-center justify-center font-bold text-[10px] shadow-sm ${
                        isFaulty ? 'bg-rose-600 text-white animate-ping' : 'bg-blue-600 text-white'
                      }`}>
                        {idx + 1}
                      </div>

                      <div className={`p-3.5 rounded-xl border transition-all ${
                        isFaulty
                          ? 'bg-rose-50 border-rose-300 shadow-sm'
                          : 'bg-slate-50 border-slate-200/80 hover:bg-white hover:shadow-xs'
                      }`}>
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[10px] font-bold text-blue-600 bg-white px-2 py-0.5 rounded border border-slate-200">
                            {hop.type} &bull; {hop.id}
                          </span>
                          <span className={`text-[10px] font-bold px-2 py-0.2 rounded-full ${
                            isFaulty ? 'bg-rose-200 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                          }`}>
                            {hop.status}
                          </span>
                        </div>
                        <div className="font-bold text-xs text-slate-900 mt-1">{hop.name}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">{hop.details}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-slate-400">
              <Activity className="w-8 h-8 mx-auto text-slate-300 mb-2" />
              <div>Select a Customer or ONT Serial to begin route tracing</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
