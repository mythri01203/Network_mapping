import React, { useMemo, useState } from 'react';
import { useNetwork } from '../../context/NetworkContext';
import { Bike, X, Navigation, MapPin, Plus, Compass, ChevronRight, AlertTriangle, Layers } from 'lucide-react';

export const BikerModePanel: React.FC = () => {
  const {
    isBikerMode,
    setIsBikerMode,
    equipments,
    customers,
    faults,
    bikerRoute,
    bikerWaypoints,
    addBikerWaypoint,
    clearBikerRoute,
    navigateToAsset,
    selectedObject,
    showToast,
  } = useNetwork();

  const [query, setQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('All');

  const allAssets = useMemo(() => {
    return [
      ...equipments.map((e) => ({
        id: e.id,
        name: e.name,
        type: e.type,
        category: e.category,
        lat: e.lat,
        lng: e.lng,
      })),
      ...faults
        .filter((f) => f.status !== 'Resolved')
        .map((f) => ({
          id: f.id,
          name: `[Outage] ${f.title}`,
          type: 'Fault Hazard',
          category: 'Faults',
          lat: f.affectedLocation.lat,
          lng: f.affectedLocation.lng,
        })),
      ...customers.map((c) => ({
        id: c.id,
        name: `${c.name} (${c.plan})`,
        type: 'Customer ONT',
        category: 'Customers',
        lat: c.lat,
        lng: c.lng,
      })),
    ];
  }, [equipments, faults, customers]);

  const nearby = useMemo(() => {
    const q = query.toLowerCase();
    return allAssets
      .filter((a) => {
        const matchesSearch =
          !q || a.id.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) || a.type.toLowerCase().includes(q);
        const matchesType =
          filterType === 'All' ||
          (filterType === 'OLT' && a.type === 'OLT') ||
          (filterType === 'FAT' && (a.type === 'FAT' || a.type.includes('Terminal Box'))) ||
          (filterType === 'Closures' && (a.type.includes('Closure') || a.type.includes('Splice'))) ||
          (filterType === 'Infrastructure' && (a.type.includes('Pole') || a.type.includes('Manhole'))) ||
          (filterType === 'Faults' && a.category === 'Faults') ||
          (filterType === 'Customers' && a.category === 'Customers');
        return matchesSearch && matchesType;
      })
      .slice(0, 16);
  }, [allAssets, query, filterType]);

  if (!isBikerMode) return null;

  const origin = selectedObject?.data?.lat
    ? {
        lat: selectedObject.data.lat,
        lng: selectedObject.data.lng,
        name: selectedObject.data.name || selectedObject.data.id,
      }
    : { lat: 12.9352, lng: 77.6245, name: 'OLT-01 Central Telco Hub' };

  return (
    <div className="absolute top-4 right-4 z-[450] w-88 max-w-[calc(100%-2rem)] bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-orange-200 overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in slide-in-from-right-4 select-none">
      {/* Header with High-Contrast Motorcycle Theme */}
      <div className="px-4 py-3 bg-gradient-to-r from-orange-600 to-amber-600 text-white flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center backdrop-blur-xs">
            <Bike className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="text-xs font-bold tracking-wide flex items-center gap-1.5">
              <span>Biker Field Navigation</span>
              <span className="text-[9px] bg-white text-orange-700 px-1.5 py-0.2 rounded font-extrabold uppercase">
                Field Ops
              </span>
            </div>
            <div className="text-[10px] text-orange-100">Motorcycle road pathing between assets</div>
          </div>
        </div>

        <button
          onClick={() => {
            setIsBikerMode(false);
            clearBikerRoute();
          }}
          className="p-1.5 text-orange-100 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          title="Exit Biker Mode"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-3.5 space-y-3 overflow-y-auto text-xs flex-1">
        {/* Profile notice */}
        <div className="p-2.5 rounded-xl bg-orange-50/80 border border-orange-200 text-orange-950 text-[11px] leading-relaxed flex items-start gap-2">
          <Compass className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />
          <div>
            <strong className="font-semibold text-orange-900">Road traffic routing:</strong> Navigates street corridors
            for technicians. Clearly distinct from underground duct and aerial fiber lines.
          </div>
        </div>

        {/* Origin Spec */}
        <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between text-[11px]">
          <div>
            <span className="text-slate-400 font-semibold block text-[10px] uppercase">Departure Origin</span>
            <span className="font-bold text-slate-800">{origin.name}</span>
          </div>
          <span className="text-[10px] text-blue-600 font-mono bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
            Current Point
          </span>
        </div>

        {/* Search Input */}
        <div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search destination OLT, FAT, Joint Closure, Customer..."
            className="w-full px-3 py-2 bg-slate-50 hover:bg-slate-100/80 focus:bg-white border border-slate-200 focus:border-orange-500 rounded-xl text-xs outline-none transition-all placeholder:text-slate-400"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex gap-1 overflow-x-auto pb-0.5 no-scrollbar text-[10px] font-semibold">
          {['All', 'OLT', 'FAT', 'Closures', 'Infrastructure', 'Faults', 'Customers'].map((cat) => (
            <button
              key={cat}
              onClick={() => setFilterType(cat)}
              className={`px-2 py-0.5 rounded-full transition-colors whitespace-nowrap ${
                filterType === cat ? 'bg-orange-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Asset Selection List */}
        <div>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center justify-between">
            <span>Select Destination Asset</span>
            <span className="text-[10px] text-slate-400">Click to Navigate</span>
          </div>

          <div className="max-h-40 overflow-y-auto space-y-1.5 pr-0.5">
            {nearby.map((asset) => (
              <div key={asset.id} className="flex items-center gap-1.5 group">
                <button
                  onClick={() => navigateToAsset(asset)}
                  className="flex-1 text-left p-2 rounded-xl border border-slate-200 hover:border-orange-400 hover:bg-orange-50/50 transition-all flex items-center justify-between"
                >
                  <div className="min-w-0 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[10px] font-bold text-orange-700 bg-orange-50 px-1.5 py-0.2 rounded border border-orange-200/60">
                        {asset.id}
                      </span>
                      <span className="font-semibold text-xs text-slate-800 truncate">{asset.name}</span>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5 truncate">{asset.type}</div>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-orange-600 shrink-0" />
                </button>

                <button
                  title="Add as Intermediate Stop"
                  onClick={() => addBikerWaypoint(asset)}
                  className="p-2 rounded-xl border border-slate-200 hover:border-amber-400 hover:bg-amber-50 text-slate-500 hover:text-amber-700 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Active Multi-Stop Waypoints Strip */}
        {bikerWaypoints.length > 0 && (
          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              Planned Route Waypoints
            </span>
            <div className="font-semibold text-slate-700 flex flex-wrap items-center gap-1">
              <span className="text-orange-600">Start</span>
              <span>&rarr;</span>
              {bikerWaypoints.map((w, idx) => (
                <React.Fragment key={w.id}>
                  <span className="bg-white px-1.5 py-0.5 rounded border border-slate-200 text-slate-800 font-mono text-[10px]">
                    {w.id}
                  </span>
                  {idx < bikerWaypoints.length - 1 && <span>&rarr;</span>}
                </React.Fragment>
              ))}
            </div>
          </div>
        )}

        {/* Active Route Telemetry & ETA */}
        {bikerRoute && (
          <div className="p-3 rounded-xl bg-orange-50 border border-orange-200 text-orange-950 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-sm text-orange-900">
                <Navigation className="w-4 h-4 text-orange-600 animate-pulse" />
                <span>{(bikerRoute.distanceMeters / 1000).toFixed(2)} km</span>
              </div>
              <div className="text-xs font-bold text-orange-800 bg-orange-100 px-2 py-0.5 rounded-md">
                ~{Math.max(1, Math.ceil(bikerRoute.durationSeconds / 60))} min travel time
              </div>
            </div>

            <div className="text-[10px] text-orange-800">
              {bikerRoute.limitation || 'Road navigation route displayed in orange dashes on GIS map.'}
            </div>

            {/* Turn-by-Turn Steps */}
            {bikerRoute.steps && bikerRoute.steps.length > 0 && (
              <div className="mt-2 pt-2 border-t border-orange-200/80">
                <div className="text-[10px] font-bold uppercase text-orange-800 mb-1">Turn-by-Turn Instructions</div>
                <ol className="max-h-24 overflow-y-auto list-decimal pl-4 space-y-1 text-[11px] text-orange-950">
                  {bikerRoute.steps.map((st, i) => (
                    <li key={i} className="leading-tight">
                      {st}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}

        {/* Clear & Mode Controls */}
        <div className="pt-1 flex gap-2">
          {bikerRoute && (
            <button
              onClick={clearBikerRoute}
              className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs transition-colors"
            >
              Clear Route
            </button>
          )}

          <button
            onClick={() => {
              setIsBikerMode(false);
              clearBikerRoute();
            }}
            className="flex-1 py-2 bg-slate-800 hover:bg-slate-900 text-white font-semibold rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5"
          >
            <span>Normal GIS Mode</span>
          </button>
        </div>

        {/* Visual Map Legend */}
        <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-100">
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-1 rounded bg-orange-500 border border-orange-600" /> Road Path
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-1 rounded bg-blue-600" /> Fiber Cables
          </span>
        </div>
      </div>
    </div>
  );
};
