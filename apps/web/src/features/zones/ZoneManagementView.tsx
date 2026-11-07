import React, { useState } from 'react';
import { MapPin, PlusCircle, Trash2 } from 'lucide-react';

import type { NetworkZone } from '@fibergis/shared';

import { useOpenView } from '../../app/views';
import { useMapStore } from '../../stores/mapStore';
import { addZone, deleteZone } from '../../stores/networkActions';
import { useNetworkStore } from '../../stores/networkStore';
import { useToastStore } from '../../stores/toastStore';

export const ZoneManagementView: React.FC = () => {
  const zones = useNetworkStore((s) => s.zones);
  const flyToLocation = useMapStore((s) => s.flyTo);
  const showToast = useToastStore((s) => s.show);
  const openView = useOpenView();

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newZoneName, setNewZoneName] = useState('');
  const [newAreaCode, setNewAreaCode] = useState('');
  const [newHomesPassed, setNewHomesPassed] = useState(1500);
  const [newCoverageSqKm, setNewCoverageSqKm] = useState(3.2);
  const [newStatus, setNewStatus] = useState<'Operational' | 'Expansion' | 'Planned'>('Expansion');

  // Overall KPIs
  const totalZones = zones.length;
  const totalHomesPassed = zones.reduce((acc, z) => acc + z.homePassed, 0);
  const totalConnected = zones.reduce((acc, z) => acc + z.connectedCustomers, 0);
  const avgPenetration = totalHomesPassed > 0 ? ((totalConnected / totalHomesPassed) * 100).toFixed(1) : '0';

  const handleCreateZone = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newZoneName || !newAreaCode) {
      showToast('error', 'Missing Information', 'Zone name and area code are required.');
      return;
    }

    const created = addZone({
      name: newZoneName,
      areaCode: newAreaCode,
      homePassed: Number(newHomesPassed),
      coverageSqKm: Number(newCoverageSqKm),
      connectedCustomers: 0,
      feederCableCount: 1,
      fatCount: 4,
      penetrationRatePct: 0,
      status: newStatus,
    });
    if (!created) return;

    setIsAddModalOpen(false);
    setNewZoneName('');
    setNewAreaCode('');
  };

  const handleLocateZone = (zone: NetworkZone) => {
    if (zone.boundaryCoords && zone.boundaryCoords.length > 0) {
      const midLat = zone.boundaryCoords.reduce((acc, c) => acc + c[0], 0) / zone.boundaryCoords.length;
      const midLng = zone.boundaryCoords.reduce((acc, c) => acc + c[1], 0) / zone.boundaryCoords.length;
      openView('map');
      setTimeout(() => {
        flyToLocation(midLat, midLng, 16);
      }, 100);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 overflow-hidden select-none">
      {/* Top Header */}
      <div className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0 shadow-xs z-10">
        <div>
          <h2 className="text-base font-bold text-slate-800">Area & Zone Coverage Management</h2>
          <p className="text-xs text-slate-500">
            Plan fiber distribution boundaries, track homes passed, and monitor subscriber penetration
          </p>
        </div>

        <button
          onClick={() => setIsAddModalOpen(true)}
          className="flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors"
        >
          <PlusCircle className="w-4 h-4" />
          <span>Create New Coverage Zone</span>
        </button>
      </div>

      {/* KPI Stats Ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 bg-slate-100/70 border-b border-slate-200/80 shrink-0">
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-[11px] font-bold text-slate-400 uppercase">Total Distribution Zones</div>
          <div className="text-xl font-extrabold text-slate-900 mt-0.5">{totalZones}</div>
        </div>
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-[11px] font-bold text-blue-600 uppercase">Total Homes Passed</div>
          <div className="text-xl font-extrabold text-blue-700 mt-0.5">{totalHomesPassed.toLocaleString()}</div>
        </div>
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-[11px] font-bold text-emerald-600 uppercase">Connected Subscribers</div>
          <div className="text-xl font-extrabold text-emerald-700 mt-0.5">{totalConnected.toLocaleString()}</div>
        </div>
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-[11px] font-bold text-indigo-600 uppercase">Overall Penetration Rate</div>
          <div className="text-xl font-extrabold text-indigo-700 mt-0.5">{avgPenetration}%</div>
        </div>
      </div>

      {/* Main Zones Grid */}
      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-7xl mx-auto">
          {zones.map((zone) => {
            const penetration =
              zone.homePassed > 0 ? ((zone.connectedCustomers / zone.homePassed) * 100).toFixed(1) : '0';

            return (
              <div
                key={zone.id}
                className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-extrabold tracking-wider bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-md">
                      {zone.areaCode}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        zone.status === 'Operational'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : zone.status === 'Expansion'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {zone.status}
                    </span>
                  </div>

                  <h3 className="text-sm font-bold text-slate-800">{zone.name}</h3>
                  <div className="text-[11px] text-slate-400 mt-0.5">Coverage: {zone.coverageSqKm} sq km</div>

                  {/* Penetration Gauge */}
                  <div className="mt-4 p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="text-slate-500 font-medium">Penetration Rate</span>
                      <span className="font-extrabold text-slate-800">{penetration}%</span>
                    </div>
                    <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-600 rounded-full transition-all"
                        style={{ width: `${Math.min(100, Number(penetration))}%` }}
                      />
                    </div>
                  </div>

                  {/* Infrastructure Counts */}
                  <div className="grid grid-cols-3 gap-2 mt-4 text-center">
                    <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                      <div className="text-[10px] text-slate-400">Homes</div>
                      <div className="text-xs font-bold text-slate-800 mt-0.5">{zone.homePassed}</div>
                    </div>
                    <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                      <div className="text-[10px] text-slate-400">FAT Boxes</div>
                      <div className="text-xs font-bold text-slate-800 mt-0.5">{zone.fatCount}</div>
                    </div>
                    <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                      <div className="text-[10px] text-slate-400">Subscribers</div>
                      <div className="text-xs font-bold text-blue-600 mt-0.5">{zone.connectedCustomers}</div>
                    </div>
                  </div>
                </div>

                {/* Card Actions */}
                <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <button
                    onClick={() => handleLocateZone(zone)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-semibold transition-colors"
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    <span>Locate Zone on GIS Map</span>
                  </button>

                  <button
                    onClick={() => deleteZone(zone.id)}
                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                    title="Delete Zone"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Add Zone Modal */}
      {isAddModalOpen && (
        <div className="modal-sheet fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md p-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <h3 className="font-bold text-sm text-slate-800">Create New Coverage Zone</h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-xs px-2 py-1 rounded"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreateZone} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">Zone Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Whitefield IT Corridor Sector 2"
                  value={newZoneName}
                  onChange={(e) => setNewZoneName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">Area Code</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. BLR-WF-02"
                  value={newAreaCode}
                  onChange={(e) => setNewAreaCode(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">Homes Passed</label>
                  <input
                    type="number"
                    min="100"
                    value={newHomesPassed}
                    onChange={(e) => setNewHomesPassed(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">Coverage Area (sq km)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={newCoverageSqKm}
                    onChange={(e) => setNewCoverageSqKm(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">Status</label>
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                >
                  <option value="Operational">Operational</option>
                  <option value="Expansion">Under Expansion</option>
                  <option value="Planned">Planned</option>
                </select>
              </div>

              <div className="border-t border-slate-100 pt-3 mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold shadow-xs"
                >
                  Save Zone
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
