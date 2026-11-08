import React from 'react';
import { Bike, Camera, CheckCircle2, Clock, MapPin } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useShallow } from 'zustand/react/shallow';

import { WORK_ORDER_STATUS_LABELS } from '@fibergis/shared';

import { useOpenView } from '../../app/views';
import { useBikerStore } from '../../stores/bikerStore';
import { useNetworkStore } from '../../stores/networkStore';
import { useSyncStore } from '../../stores/syncStore';
import { useUiStore } from '../../stores/uiStore';

export const FieldWorkView: React.FC = () => {
  const { workOrders, equipments } = useNetworkStore(
    useShallow((s) => ({ workOrders: s.workOrders, equipments: s.equipment })),
  );
  const setIsBikerMode = useBikerStore((s) => s.setBikerMode);
  const { setSelectedObject, setModalOpen } = useUiStore(
    useShallow((s) => ({ setSelectedObject: s.select, setModalOpen: s.setModalOpen })),
  );
  const openView = useOpenView();
  const navigate = useNavigate();
  const sync = useSyncStore();
  const syncText = sync.cacheWriteFailed
    ? 'Not saved on this phone: storage is full. Stay connected until changes reach the office.'
    : sync.phase === 'offline'
      ? `Offline. ${sync.pendingCount} change(s) saved on this phone, waiting to send.`
      : sync.phase === 'error'
        ? (sync.error ?? 'The office refused an item. Open the sync menu at the top.')
        : sync.pendingCount > 0
          ? `Sending ${sync.pendingCount} change(s) to the office.`
          : sync.phase === 'connecting'
            ? 'Connecting to the office.'
            : 'All changes sent to the office.';

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Field Work</h1>
            <p className="text-xs text-slate-500">Technician jobs, navigation, and what has reached the office.</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                openView('map');
                setIsBikerMode(true);
              }}
              className="px-3 py-2 bg-orange-600 text-white rounded-xl text-xs font-bold flex items-center gap-1.5"
            >
              <Bike className="w-4 h-4" /> Open Biker Mode
            </button>
            <button
              onClick={() => navigate('/jobs')}
              data-testid="open-jobs"
              className="px-3 py-2 bg-white border rounded-xl text-xs font-semibold"
            >
              Technician jobs (phone)
            </button>
          </div>
        </div>

        <div className="p-3 rounded-xl border bg-white text-xs" role="status">
          <span className="font-semibold">Sync: </span>
          {syncText}
        </div>

        <div className="grid gap-3">
          {workOrders.map((wo) => {
            const eq = equipments.find((e) => e.id === wo.equipmentId);
            return (
              <div
                key={wo.id}
                className="bg-white border rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3"
              >
                <div className="flex-1">
                  <div className="font-mono text-[11px] text-blue-600">{wo.id}</div>
                  <div className="font-bold text-sm text-slate-900">{wo.title}</div>
                  <div className="text-xs text-slate-500">
                    {wo.type} · {wo.priority} · {wo.technicianName}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">{wo.notes}</div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => {
                      if (eq) {
                        setSelectedObject({ type: 'equipment', data: eq });
                        openView('map');
                        useBikerStore.getState().navigateTo({ id: eq.id, name: eq.name, lat: eq.lat, lng: eq.lng });
                        useBikerStore.getState().setBikerMode(true);
                        useBikerStore.getState().setActiveBikerTab('navigation');
                      }
                    }}
                    className="px-2.5 py-1.5 bg-orange-50 text-orange-800 border border-orange-200 rounded-lg text-[11px] font-semibold flex items-center gap-1 hover:bg-orange-100 transition-colors"
                  >
                    <MapPin className="w-3.5 h-3.5" /> Navigate
                  </button>
                  <button
                    onClick={() => setModalOpen('faults', true)}
                    className="px-2.5 py-1.5 border rounded-lg text-[11px] font-semibold"
                  >
                    Report fault
                  </button>
                  {/* A job is finished on the phone (/jobs) and closed by the office only with a check. */}
                  <span className="px-2.5 py-1.5 text-[11px] font-bold text-slate-700 flex items-center gap-1">
                    {wo.status === 'Verified' || wo.status === 'Closed' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" /> : <Clock className="w-3.5 h-3.5" />}
                    {WORK_ORDER_STATUS_LABELS[wo.status]}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="text-[11px] text-slate-400 flex items-center gap-1">
          <Camera className="w-3.5 h-3.5" /> Photos are added beside existing ones and never replace an original.
        </div>
      </div>
    </div>
  );
};
