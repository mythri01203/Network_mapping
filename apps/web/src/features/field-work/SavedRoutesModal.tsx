import React from 'react';
import { Bike, Calendar, Clock, Eye, MapPin, Navigation, Route, Trash2, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import type { GpsRoute } from '@fibergis/shared';

import { useBikerStore } from '../../stores/bikerStore';
import { deleteGpsRoute } from '../../stores/networkActions';
import { useNetworkStore } from '../../stores/networkStore';

export const SavedRoutesModal: React.FC = () => {
  const { savedRoutesModalOpen, setSavedRoutesModalOpen, loadSavedRoute, activeSavedRoute, clearActiveSavedRoute } =
    useBikerStore(
      useShallow((s) => ({
        savedRoutesModalOpen: s.savedRoutesModalOpen,
        setSavedRoutesModalOpen: s.setSavedRoutesModalOpen,
        loadSavedRoute: s.loadSavedRoute,
        activeSavedRoute: s.activeSavedRoute,
        clearActiveSavedRoute: s.clearActiveSavedRoute,
      })),
    );

  const gpsRoutes = useNetworkStore((s) => s.gpsRoutes) || [];

  if (!savedRoutesModalOpen) return null;

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="modal-sheet fixed inset-0 z-[1200] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in select-none">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-orange-600 to-amber-600 text-white">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center ring-1 ring-white/30">
              <Bike className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold">Saved Bike GPS Routes</h2>
              <p className="text-xs text-orange-100">
                {gpsRoutes.length} saved route{gpsRoutes.length === 1 ? '' : 's'} in database
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setSavedRoutesModalOpen(false)}
            className="p-1.5 text-orange-100 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-3 flex-1">
          {activeSavedRoute && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Route className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-semibold">Currently Displaying: {activeSavedRoute.name}</span>
              </div>
              <button
                type="button"
                onClick={clearActiveSavedRoute}
                className="px-2 py-1 rounded bg-emerald-100 hover:bg-emerald-200 text-emerald-800 text-[11px] font-medium"
              >
                Hide from Map
              </button>
            </div>
          )}

          {gpsRoutes.length === 0 ? (
            <div className="py-12 text-center text-slate-400 space-y-2">
              <Navigation className="w-10 h-10 mx-auto text-slate-300" />
              <p className="text-sm font-medium text-slate-600">No saved GPS routes yet</p>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Open Bike Mode, click <strong>Start Live GPS Tracking</strong>, ride your route, then click{' '}
                <strong>Save Route</strong>.
              </p>
            </div>
          ) : (
            gpsRoutes.map((route: GpsRoute) => {
              const isLoaded = activeSavedRoute?.id === route.id;
              return (
                <div
                  key={route.id}
                  className={`p-4 rounded-xl border transition-all flex items-center justify-between gap-4 ${
                    isLoaded ? 'bg-orange-50/60 border-orange-300 shadow-xs' : 'bg-slate-50/70 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-slate-800 truncate">{route.name}</span>
                      <span className="text-[10px] font-mono bg-orange-100 text-orange-800 px-1.5 py-0.2 rounded font-semibold">
                        {route.travelMode.toUpperCase()}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span className="flex items-center gap-1 font-semibold text-slate-700">
                        <Route className="w-3.5 h-3.5 text-orange-600" />
                        {route.distanceKm.toFixed(2)} km
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        {formatDuration(route.durationSeconds)}
                      </span>
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-slate-400" />
                        {route.coordinates.length} GPS points
                      </span>
                      {route.startTime && (
                        <span className="flex items-center gap-1 text-[11px] text-slate-400">
                          <Calendar className="w-3 h-3" />
                          {new Date(route.startTime).toLocaleDateString()}
                        </span>
                      )}
                    </div>

                    {route.notes && <p className="text-[11px] text-slate-500 italic truncate">{route.notes}</p>}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => loadSavedRoute(route)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                        isLoaded
                          ? 'bg-orange-600 text-white'
                          : 'bg-white hover:bg-orange-50 text-orange-700 border border-orange-200'
                      }`}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>{isLoaded ? 'Viewing' : 'View on Map'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => deleteGpsRoute(route.id)}
                      className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors"
                      title="Delete saved route"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex justify-end">
          <button
            type="button"
            onClick={() => setSavedRoutesModalOpen(false)}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white font-medium rounded-xl text-xs transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

