import React, { useRef, useState } from 'react';
import { Camera, CheckCircle2, Navigation, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { useBikerStore } from '../../stores/bikerStore';
import { updateWorkOrderStatus, uploadEquipmentPhoto } from '../../stores/networkActions';
import { useNetworkStore } from '../../stores/networkStore';
import { useToastStore } from '../../stores/toastStore';
import { useUiStore } from '../../stores/uiStore';

export const TechnicianMobileView: React.FC = () => {
  const { isTechnicianMobileOpen, setModalOpen } = useUiStore(
    useShallow((s) => ({ isTechnicianMobileOpen: s.modals.technicianMobile, setModalOpen: s.setModalOpen })),
  );
  const { workOrders, equipments, splitters } = useNetworkStore(
    useShallow((s) => ({ workOrders: s.workOrders, equipments: s.equipment, splitters: s.splitters })),
  );
  const showToast = useToastStore((s) => s.show);

  const [activeTab, setActiveTab] = useState<'orders' | 'box_checker' | 'photo_capture'>('orders');
  const [selectedBoxId, setSelectedBoxId] = useState<string>('');
  const userRole = useUiStore((s) => s.userRole);
  const photoInput = useRef<HTMLInputElement>(null);
  const [savingPhoto, setSavingPhoto] = useState(false);

  if (!isTechnicianMobileOpen) return null;

  const boxes = equipments.filter((e) => e.type === 'FAT' || e.type.includes('Terminal Box'));
  const currentBox = boxes.find((e) => e.id === selectedBoxId) ?? boxes[0];
  const boxSplitter = currentBox ? splitters.find((s) => s.terminalBoxId === currentBox.id) : undefined;

  // Only a real photo is saved, and success is reported only when it was saved.
  const handlePhotoChosen = (file: File | undefined) => {
    if (!file || !currentBox) return;
    setSavingPhoto(true);
    const reader = new FileReader();
    reader.onerror = () => {
      setSavingPhoto(false);
      showToast('error', 'Photo not saved', 'The photo could not be read. Try taking it again.');
    };
    reader.onload = () => {
      setSavingPhoto(false);
      const saved = uploadEquipmentPhoto(currentBox.id, {
        url: typeof reader.result === 'string' ? reader.result : undefined,
        name: file.name || 'Field photo.jpg',
        category: 'Maintenance',
        description: 'Taken in the technician phone view',
        uploadedBy: userRole,
      });
      if (!saved) showToast('error', 'Photo not saved', 'Nothing was attached. Try again.');
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="modal-sheet fixed inset-0 z-[1100] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 select-none">
      {/* Mobile Shell Mockup */}
      <div className="bg-slate-900 border-4 border-slate-700 rounded-[38px] p-3 shadow-2xl w-full max-w-sm flex flex-col h-[740px] max-h-[96vh] text-white overflow-hidden relative">
        {/* Phone Speaker Notch */}
        <div className="w-32 h-4 bg-slate-800 rounded-full mx-auto mb-2 shrink-0"></div>

        {/* Mobile Header */}
        <div className="px-3 py-2 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <div>
              <div className="text-xs font-bold leading-tight">Field Technician Portal</div>
              <div className="text-[10px] text-slate-400">{userRole}</div>
            </div>
          </div>
          <button
            onClick={() => setModalOpen('technicianMobile', false)}
            aria-label="Close"
            className="p-1 text-slate-400 hover:text-white rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mobile Nav Tabs */}
        <div className="grid grid-cols-3 gap-1 p-2 bg-slate-800/80 my-2 rounded-xl text-center text-xs shrink-0">
          <button
            onClick={() => setActiveTab('orders')}
            className={`py-1.5 rounded-lg font-bold transition-all ${
              activeTab === 'orders' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Work Orders
          </button>
          <button
            onClick={() => setActiveTab('box_checker')}
            className={`py-1.5 rounded-lg font-bold transition-all ${
              activeTab === 'box_checker' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Port Checker
          </button>
          <button
            onClick={() => setActiveTab('photo_capture')}
            className={`py-1.5 rounded-lg font-bold transition-all ${
              activeTab === 'photo_capture' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Snap Photo
          </button>
        </div>

        {/* Mobile Screen Body */}
        <div className="flex-1 overflow-y-auto px-1 space-y-3">
          {/* TAB 1: WORK ORDERS */}
          {activeTab === 'orders' && (
            <div className="space-y-2.5">
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider px-1">
                Assigned Jobs ({workOrders.length})
              </div>
              {workOrders.map((wo) => (
                <div key={wo.id} className="p-3 bg-slate-800 rounded-2xl border border-slate-700/80 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] font-bold text-blue-400">{wo.id}</span>
                    <span
                      className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                        wo.status === 'Completed'
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : 'bg-amber-500/20 text-amber-300'
                      }`}
                    >
                      {wo.status}
                    </span>
                  </div>
                  <div className="font-bold text-xs text-white">{wo.title}</div>
                  <div className="text-[11px] text-slate-400">{wo.notes}</div>

                  <div className="pt-2 border-t border-slate-700 flex items-center justify-between">
                    <span className="text-[10px] text-slate-400">{wo.scheduledDate}</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          const eq = equipments.find((e) => e.id === wo.equipmentId);
                          if (eq) {
                            setModalOpen('technicianMobile', false);
                            useUiStore.getState().select({ type: 'equipment', data: eq });
                            useBikerStore.getState().navigateTo({ id: eq.id, name: eq.name, lat: eq.lat, lng: eq.lng });
                            useBikerStore.getState().setBikerMode(true);
                            useBikerStore.getState().setActiveBikerTab('navigation');
                          }
                        }}
                        className="px-2 py-1 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1"
                      >
                        <Navigation className="w-3.5 h-3.5" /> Navigate
                      </button>
                      {wo.status !== 'Completed' ? (
                        <button
                          onClick={() => updateWorkOrderStatus(wo.id, 'Completed')}
                          className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> Mark Done
                        </button>
                      ) : (
                        <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Finished
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* TAB 2: PORT & CORE CHECKER */}
          {activeTab === 'box_checker' && (
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                  Select FAT / FDT Box:
                </label>
                <select
                  value={currentBox?.id ?? ''}
                  onChange={(e) => setSelectedBoxId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white outline-none"
                >
                  {boxes.length === 0 && <option value="">No terminal boxes yet</option>}
                  {boxes.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} ({e.id})
                    </option>
                  ))}
                </select>
              </div>

              {currentBox && (
                <div className="p-3 bg-slate-800 rounded-2xl border border-slate-700 space-y-1">
                  <div className="font-bold text-xs text-white">{currentBox.name}</div>
                  <div className="text-[11px] text-slate-400">
                    {[currentBox.street, currentBox.area].filter(Boolean).join(', ') || 'Location details not recorded'}
                  </div>
                  <div className="text-[10px] text-blue-400">
                    Pole: {currentBox.poleNumber || 'Not recorded'} &bull; Map position: {currentBox.lat.toFixed(4)},{' '}
                    {currentBox.lng.toFixed(4)}
                  </div>
                </div>
              )}

              {boxSplitter && (
                <div className="space-y-1.5">
                  <div className="text-[10px] font-bold text-slate-400 uppercase">
                    Available Ports ({boxSplitter.ratio})
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {boxSplitter.outputPorts.map((p) => {
                      const isFree = p.status === 'Available';
                      return (
                        <div
                          key={p.portNumber}
                          className={`p-2 rounded-xl text-center font-bold text-xs ${
                            isFree ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-500 border border-slate-700'
                          }`}
                        >
                          <div>Port {p.portNumber}</div>
                          <div className="text-[8px] font-normal opacity-75">{isFree ? 'FREE' : 'USED'}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: SNAP PHOTO */}
          {activeTab === 'photo_capture' && (
            <div className="space-y-3 text-xs text-center py-6">
              <div className="w-20 h-20 rounded-full bg-slate-800 border-2 border-dashed border-slate-600 flex items-center justify-center mx-auto text-slate-400">
                <Camera className="w-8 h-8 text-blue-400" />
              </div>
              <div className="font-bold text-sm text-white">Capture Terminal Installation Photo</div>
              <p className="text-slate-400 text-xs px-4">
                {currentBox
                  ? `Take a photo of ${currentBox.name} to attach to its record.`
                  : 'Place a terminal box on the map first.'}
              </p>
              <input
                ref={photoInput}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  handlePhotoChosen(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                disabled={!currentBox || savingPhoto}
                onClick={() => photoInput.current?.click()}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-2xl font-bold shadow-lg flex items-center justify-center gap-2 transition-all mt-4"
              >
                <Camera className="w-4 h-4" /> {savingPhoto ? 'Saving photo…' : 'Take Photo'}
              </button>
              <p className="text-[10px] text-slate-500 px-4">
                Photos are kept with the box record in this browser, then sent to the office with the next sync.
              </p>
            </div>
          )}
        </div>

        {/* Mobile Home Bar */}
        <div className="w-28 h-1 bg-slate-700 rounded-full mx-auto mt-2 shrink-0"></div>
      </div>
    </div>
  );
};
