import React, { useState } from 'react';
import { useNetwork } from '../../context/NetworkContext';
import { Bike, MapPin, CheckCircle2, Clock, Camera } from 'lucide-react';

export const FieldWorkView: React.FC = () => {
  const {
    workOrders,
    updateWorkOrderStatus,
    setIsBikerMode,
    setActiveMainView,
    flyToLocation,
    equipments,
    setSelectedObject,
    setIsTechnicianMobileOpen,
    setIsFaultModalOpen
  } = useNetwork();
  const [offlineDraft, setOfflineDraft] = useState(false);

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Field Work</h1>
            <p className="text-xs text-slate-500">Technician jobs, navigation, and offline draft status.</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { setActiveMainView('map'); setIsBikerMode(true); }}
              className="px-3 py-2 bg-orange-600 text-white rounded-xl text-xs font-bold flex items-center gap-1.5"
            >
              <Bike className="w-4 h-4" /> Open Biker Mode
            </button>
            <button onClick={() => setIsTechnicianMobileOpen(true)} className="px-3 py-2 bg-white border rounded-xl text-xs font-semibold">
              Technician phone view
            </button>
          </div>
        </div>

        <div className="p-3 rounded-xl border bg-white text-xs flex items-center justify-between">
          <span>Offline drafts: {offlineDraft ? 'unsynced notes stored on this device' : 'connected — changes save locally as sample data'}</span>
          <button onClick={() => setOfflineDraft(!offlineDraft)} className="px-2 py-1 border rounded-lg font-semibold">
            {offlineDraft ? 'Mark synced' : 'Simulate offline draft'}
          </button>
        </div>

        <div className="grid gap-3">
          {workOrders.map(wo => {
            const eq = equipments.find(e => e.id === wo.equipmentId);
            return (
              <div key={wo.id} className="bg-white border rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1">
                  <div className="font-mono text-[11px] text-blue-600">{wo.id}</div>
                  <div className="font-bold text-sm text-slate-900">{wo.title}</div>
                  <div className="text-xs text-slate-500">{wo.type} · {wo.priority} · {wo.technicianName}</div>
                  <div className="text-[11px] text-slate-400 mt-1">{wo.notes}</div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => {
                      if (eq) {
                        setSelectedObject({ type: 'equipment', data: eq });
                        setActiveMainView('map');
                        setIsBikerMode(true);
                        flyToLocation(eq.lat, eq.lng, 18);
                      }
                    }}
                    className="px-2.5 py-1.5 bg-orange-50 text-orange-800 border border-orange-200 rounded-lg text-[11px] font-semibold flex items-center gap-1"
                  >
                    <MapPin className="w-3.5 h-3.5" /> Navigate
                  </button>
                  <button onClick={() => setIsFaultModalOpen(true)} className="px-2.5 py-1.5 border rounded-lg text-[11px] font-semibold">Report fault</button>
                  {wo.status !== 'Completed' ? (
                    <button onClick={() => updateWorkOrderStatus(wo.id, 'Completed')} className="px-2.5 py-1.5 bg-emerald-600 text-white rounded-lg text-[11px] font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Complete
                    </button>
                  ) : (
                    <span className="px-2.5 py-1.5 text-[11px] font-bold text-emerald-700 flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Completed</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="text-[11px] text-slate-400 flex items-center gap-1">
          <Camera className="w-3.5 h-3.5" /> Photo uploads stay as local sample overlays and do not overwrite original images.
        </div>
      </div>
    </div>
  );
};
