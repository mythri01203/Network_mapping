import React, { useState } from 'react';
import { useNetwork } from '../../context/NetworkContext';
import { Fault, WorkOrder } from '../../types/network';
import {
  X,
  AlertTriangle,
  Wrench,
  Users,
  MapPin,
  CheckCircle2,
  Clock,
  Send,
  Plus,
  ShieldAlert
} from 'lucide-react';

export const FaultManagementModal: React.FC = () => {
  const {
    isFaultModalOpen,
    setIsFaultModalOpen,
    faults,
    workOrders,
    customers,
    cables,
    equipments,
    recordNewFault,
    resolveExistingFault,
    updateWorkOrderStatus,
    flyToLocation,
    showToast
  } = useNetwork();

  const [activeTab, setActiveTab] = useState<'active_faults' | 'new_fault' | 'work_orders'>('active_faults');
  const [selectedFaultId, setSelectedFaultId] = useState<string>(faults[0]?.id || '');

  // Form for new fault
  const [faultType, setFaultType] = useState<Fault['type']>('Fiber Cut');
  const [faultTitle, setFaultTitle] = useState('Severe Aerial Fiber Span Cut');
  const [severity, setSeverity] = useState<Fault['severity']>('Critical');
  const [affectedCableId, setAffectedCableId] = useState<string>(cables[0]?.id || '');
  const [description, setDescription] = useState('Construction backhoe severed underground conduit near junction.');

  if (!isFaultModalOpen) return null;

  const currentFault = faults.find(f => f.id === selectedFaultId) || faults[0];

  const handleCreateFault = (e: React.FormEvent) => {
    e.preventDefault();
    recordNewFault({
      title: faultTitle,
      type: faultType,
      severity,
      affectedCableId,
      description,
      affectedCustomerIds: ['CUST-001', 'CUST-002', 'CUST-003', 'CUST-004'],
      affectedCores: [1, 2, 3, 4]
    });
    setActiveTab('active_faults');
  };

  return (
    <div className="fixed inset-0 z-[1000] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in select-none">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-rose-600 text-white flex items-center justify-center shadow-xs">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-sm text-slate-900">Network Fault & Outage Management</h2>
              <p className="text-[11px] text-slate-500">Incident response, downstream subscriber impact & technician dispatch</p>
            </div>
          </div>
          <button
            onClick={() => setIsFaultModalOpen(false)}
            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Strip */}
        <div className="px-6 py-2 border-b border-slate-100 bg-slate-100/50 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('active_faults')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                activeTab === 'active_faults' ? 'bg-white text-rose-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Active Outages ({faults.filter(f => f.status !== 'Resolved').length})
            </button>
            <button
              onClick={() => setActiveTab('work_orders')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                activeTab === 'work_orders' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Field Work Orders ({workOrders.length})
            </button>
          </div>

          <button
            onClick={() => setActiveTab('new_fault')}
            className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Report Outage</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 text-xs">
          {/* TAB 1: ACTIVE FAULTS */}
          {activeTab === 'active_faults' && (
            <div className="grid grid-cols-3 gap-5">
              {/* Faults List */}
              <div className="space-y-2 border-r border-slate-100 pr-4">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Reported Incidents</div>
                {faults.map(f => (
                  <button
                    key={f.id}
                    onClick={() => setSelectedFaultId(f.id)}
                    className={`w-full p-3 rounded-xl border text-left transition-all ${
                      selectedFaultId === f.id
                        ? 'bg-rose-50 border-rose-300 ring-2 ring-rose-200'
                        : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] font-bold text-rose-700">{f.id}</span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                        f.severity === 'Critical' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {f.severity}
                      </span>
                    </div>
                    <div className="font-bold text-xs text-slate-900 mt-1 truncate">{f.title}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{f.type} &bull; {f.status}</div>
                  </button>
                ))}
              </div>

              {/* Fault Deep Dive */}
              {currentFault ? (
                <div className="col-span-2 space-y-4">
                  <div className="p-4 bg-rose-50/80 rounded-2xl border border-rose-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-sm text-rose-950">{currentFault.title}</h3>
                      <span className="px-2.5 py-1 bg-rose-600 text-white rounded-lg text-xs font-bold shadow-xs">
                        {currentFault.status}
                      </span>
                    </div>
                    <p className="text-slate-700 text-xs leading-relaxed">{currentFault.description}</p>
                    <div className="pt-2 border-t border-rose-200/60 flex items-center justify-between text-[11px] text-slate-600">
                      <span>Reported: {currentFault.reportedAt}</span>
                      <span>Assigned: <strong className="text-slate-900">{currentFault.assignedTechnician}</strong></span>
                    </div>
                  </div>

                  {/* Impacted Subscribers Box */}
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                    <div className="font-bold text-xs text-slate-800 flex items-center gap-1.5">
                      <Users className="w-4 h-4 text-rose-600" />
                      <span>Impacted Downstream Subscribers ({currentFault.affectedCustomerIds.length})</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto">
                      {currentFault.affectedCustomerIds.map(cid => {
                        const cust = customers.find(c => c.id === cid);
                        return (
                          <div key={cid} className="p-2 bg-white rounded-lg border border-slate-200 text-[11px]">
                            <div className="font-bold text-slate-800">{cust?.name || cid}</div>
                            <div className="text-[10px] text-slate-400">{cust?.mobile} &bull; {cust?.plan}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-3 pt-2">
                    <button
                      onClick={() => {
                        flyToLocation(currentFault.affectedLocation.lat, currentFault.affectedLocation.lng, 18);
                        setIsFaultModalOpen(false);
                      }}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-semibold flex items-center gap-1.5 transition-colors"
                    >
                      <MapPin className="w-4 h-4" /> Locate on GIS Map
                    </button>

                    {currentFault.status !== 'Resolved' && (
                      <button
                        onClick={() => resolveExistingFault(currentFault.id)}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold flex items-center gap-1.5 shadow-xs transition-colors"
                      >
                        <CheckCircle2 className="w-4 h-4" /> Mark Outage Resolved
                      </button>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* TAB 2: NEW FAULT FORM */}
          {activeTab === 'new_fault' && (
            <form onSubmit={handleCreateFault} className="max-w-xl mx-auto space-y-4">
              <div className="font-bold text-sm text-slate-900 border-b pb-2">Log Network Fault & Dispatch Crew</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Fault Type</label>
                  <select
                    value={faultType}
                    onChange={e => setFaultType(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none"
                  >
                    <option value="Fiber Cut">Fiber Cut (Physical Sever)</option>
                    <option value="Cable Damage">Cable Damage / Rodent Bite</option>
                    <option value="High Attenuation">High Attenuation / Macro-bend</option>
                    <option value="Equipment Failure">Equipment Failure</option>
                    <option value="Splitter Failure">Splitter Port Breakdown</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Severity Level</label>
                  <select
                    value={severity}
                    onChange={e => setSeverity(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none"
                  >
                    <option value="Critical">Critical (Complete Hub Cut)</option>
                    <option value="High">High (Multiple Subscribers)</option>
                    <option value="Medium">Medium (Single Drop / Attenuation)</option>
                    <option value="Low">Low (Cosmetic / Inspection)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Incident Headline</label>
                <input
                  type="text"
                  value={faultTitle}
                  onChange={e => setFaultTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Affected Cable</label>
                <select
                  value={affectedCableId}
                  onChange={e => setAffectedCableId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none"
                >
                  {cables.map(c => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Description & Field Evidence</label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none text-xs"
                />
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  className="px-6 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl font-bold shadow-md flex items-center gap-2"
                >
                  <Send className="w-4 h-4" /> Register Fault & Dispatch
                </button>
              </div>
            </form>
          )}

          {/* TAB 3: WORK ORDERS */}
          {activeTab === 'work_orders' && (
            <div className="space-y-3">
              <div className="font-bold text-xs text-slate-800">Technician Assigned Work Orders</div>
              <div className="space-y-2">
                {workOrders.map(wo => (
                  <div key={wo.id} className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] font-bold text-blue-600">{wo.id}</span>
                        <span className="font-bold text-xs text-slate-800">{wo.title}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1">
                        Technician: <strong className="text-slate-800">{wo.technicianName}</strong> ({wo.technicianPhone}) &bull; Scheduled: {wo.scheduledDate}
                      </div>
                      <div className="text-[11px] text-slate-600 mt-0.5">{wo.notes}</div>
                    </div>

                    <div className="flex items-center gap-3">
                      <select
                        value={wo.status}
                        onChange={e => updateWorkOrderStatus(wo.id, e.target.value as any)}
                        className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white border border-slate-200 outline-none"
                      >
                        <option value="Pending">Pending</option>
                        <option value="Assigned">Assigned</option>
                        <option value="In Progress">In Progress</option>
                        <option value="Completed">Completed</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
