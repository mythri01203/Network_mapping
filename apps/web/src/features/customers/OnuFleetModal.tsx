import React, { useMemo, useState } from 'react';
import {
  HardDrive,
  MapPin,
  Radio,
  Route,
  Search,
  X,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import type { Customer } from '@fibergis/shared';

import { Button, cn } from '../../components/ui';
import { useMapStore } from '../../stores/mapStore';
import { useNetworkStore } from '../../stores/networkStore';
import { useToastStore } from '../../stores/toastStore';
import { useUiStore } from '../../stores/uiStore';

export const OnuFleetModal: React.FC = () => {
  const { isFleetOpen, setModalOpen, openFiberTrace, setPickingOnuCustomer } = useUiStore(
    useShallow((s) => ({
      isFleetOpen: s.modals.onuFleet,
      setModalOpen: s.setModalOpen,
      openFiberTrace: s.openFiberTrace,
      setPickingOnuCustomer: s.setPickingOnuCustomer,
    })),
  );

  const customers = useNetworkStore((s) => s.customers);
  const flyToLocation = useMapStore((s) => s.flyTo);
  const showToast = useToastStore((s) => s.show);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Active' | 'Low Signal' | 'Unmapped'>('All');

  const filteredOnus = useMemo(() => {
    return customers.filter((c) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.ontSerialNumber.toLowerCase().includes(q) ||
        c.routerModel.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q);

      const isMapped = c.lat !== 0 && c.lng !== 0;
      const isLowSignal = c.rxOpticalPowerDbm < -24.0;

      if (!matchesSearch) return false;
      if (statusFilter === 'Active') return c.status === 'Active';
      if (statusFilter === 'Low Signal') return isLowSignal;
      if (statusFilter === 'Unmapped') return !isMapped;
      return true;
    });
  }, [customers, searchQuery, statusFilter]);

  if (!isFleetOpen) return null;

  const totalCount = customers.length;
  const unmappedCount = customers.filter((c) => c.lat === 0 && c.lng === 0).length;
  const lowSignalCount = customers.filter((c) => c.rxOpticalPowerDbm < -24.0).length;

  const handlePickOnMap = (customer: Customer) => {
    // 1. Set the active ONU customer to place
    setPickingOnuCustomer(customer);
    // 2. Close this modal to reveal the GIS map
    setModalOpen('onuFleet', false);
    // 3. Inform user with toast
    showToast(
      'info',
      'Click Map to Place ONU',
      `Click anywhere on the map to place ONU for ${customer.name} (${customer.ontSerialNumber}).`,
    );
  };

  const handleTrace = (customer: Customer) => {
    openFiberTrace(customer.id);
  };

  const handleLocate = (customer: Customer) => {
    if (customer.lat && customer.lng) {
      flyToLocation(customer.lat, customer.lng, 18);
      setModalOpen('onuFleet', false);
      showToast('info', 'Located on Map', `Focused on ${customer.name}'s ONT.`);
    }
  };

  return (
    <div className="fixed inset-0 z-[1150] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in select-none">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-sky-600 text-white flex items-center justify-center shadow-xs">
              <Radio className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-sm text-slate-900">ONU Fleet & Subscriber Optical Matrix</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-200">
                  {totalCount} Total ONUs
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                Live subscriber ONT diagnostics, optical power levels, and geocoded placement
              </p>
            </div>
          </div>

          <button
            onClick={() => setModalOpen('onuFleet', false)}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filters and Stats Bar */}
        <div className="px-6 py-3 border-b border-slate-100 bg-slate-50/50 flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search serial number, customer name, model..."
              className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:border-sky-500"
            />
          </div>

          <div className="flex items-center gap-1.5 text-xs">
            <button
              onClick={() => setStatusFilter('All')}
              className={cn(
                'px-3 py-1 rounded-lg font-medium transition-colors',
                statusFilter === 'All' ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100',
              )}
            >
              All ({totalCount})
            </button>
            <button
              onClick={() => setStatusFilter('Active')}
              className={cn(
                'px-3 py-1 rounded-lg font-medium transition-colors',
                statusFilter === 'Active' ? 'bg-emerald-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100',
              )}
            >
              Active
            </button>
            <button
              onClick={() => setStatusFilter('Low Signal')}
              className={cn(
                'px-3 py-1 rounded-lg font-medium transition-colors',
                statusFilter === 'Low Signal' ? 'bg-amber-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100',
              )}
            >
              Low Signal ({lowSignalCount})
            </button>
            <button
              onClick={() => setStatusFilter('Unmapped')}
              className={cn(
                'px-3 py-1 rounded-lg font-medium transition-colors',
                statusFilter === 'Unmapped' ? 'bg-rose-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100',
              )}
            >
              Unmapped ({unmappedCount})
            </button>
          </div>
        </div>

        {/* Fleet Table */}
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50/90 text-slate-500 font-semibold uppercase text-[10px] tracking-wider border-b border-slate-200 sticky top-0 z-10 backdrop-blur">
              <tr>
                <th className="py-2.5 px-4">Serial Number</th>
                <th className="py-2.5 px-4">Customer Name</th>
                <th className="py-2.5 px-4">ONU Model</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4">Optical Rx Power</th>
                <th className="py-2.5 px-4">Map Location</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {filteredOnus.map((c) => {
                const rx = c.rxOpticalPowerDbm;
                const isNormal = rx >= -24.0 && rx <= -8.0;
                const isWarning = rx < -24.0 && rx >= -27.0;
                const isMapped = c.lat !== 0 && c.lng !== 0;

                return (
                  <tr key={c.id} className="hover:bg-slate-50/70 transition-colors">
                    {/* Serial Number */}
                    <td className="py-3 px-4 font-mono font-bold text-slate-900">
                      <div className="flex items-center gap-2">
                        <HardDrive className="w-4 h-4 text-sky-600 shrink-0" />
                        <span>{c.ontSerialNumber}</span>
                      </div>
                    </td>

                    {/* Customer */}
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">{c.name}</div>
                      <div className="text-[11px] text-slate-400">{c.id} · {c.area}</div>
                    </td>

                    {/* Model */}
                    <td className="py-3 px-4 text-slate-600">
                      <div className="truncate max-w-[170px]" title={c.routerModel}>
                        {c.routerModel}
                      </div>
                    </td>

                    {/* Status */}
                    <td className="py-3 px-4">
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded-full font-semibold text-[10px]',
                          c.status === 'Active'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-slate-100 text-slate-600',
                        )}
                      >
                        {c.status}
                      </span>
                    </td>

                    {/* Optical Rx Power */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'w-2 h-2 rounded-full',
                            isNormal ? 'bg-emerald-500' : isWarning ? 'bg-amber-500' : 'bg-red-500',
                          )}
                        />
                        <span className="font-mono font-bold text-slate-900">
                          {rx.toFixed(1)} dBm
                        </span>
                        <span
                          className={cn(
                            'text-[10px] px-1.5 py-0.2 rounded font-medium',
                            isNormal
                              ? 'text-emerald-700 bg-emerald-50'
                              : isWarning
                                ? 'text-amber-700 bg-amber-50'
                                : 'text-red-700 bg-red-50',
                          )}
                        >
                          {isNormal ? 'Normal' : isWarning ? 'Warning' : 'Critical'}
                        </span>
                      </div>
                    </td>

                    {/* Map Status */}
                    <td className="py-3 px-4">
                      {isMapped ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-600">
                          <MapPin className="w-3.5 h-3.5 text-emerald-600" />
                          <span>[{c.lat.toFixed(3)}, {c.lng.toFixed(3)}]</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200">
                          Unmapped
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {isMapped && (
                          <button
                            type="button"
                            onClick={() => handleLocate(c)}
                            className="p-1 rounded-md text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 border border-slate-200 transition-colors"
                            title="Focus on Map"
                          >
                            <MapPin className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {/* Pick on Map Trigger */}
                        <button
                          type="button"
                          onClick={() => handlePickOnMap(c)}
                          className="px-2 py-1 rounded-md text-[11px] font-medium bg-sky-50 text-sky-700 hover:bg-sky-100 border border-sky-200 flex items-center gap-1 transition-colors"
                          title="Place pin on GIS map and splice to splitter"
                        >
                          <MapPin className="w-3.5 h-3.5" />
                          <span>Pick on Map</span>
                        </button>

                        {/* Fiber Trace */}
                        <button
                          type="button"
                          onClick={() => handleTrace(c)}
                          className="px-2 py-1 rounded-md text-[11px] font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 flex items-center gap-1 transition-colors"
                          title="Trace optical signal path to OLT"
                        >
                          <Route className="w-3.5 h-3.5" />
                          <span>Trace</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <div>
            Showing <strong className="text-slate-700">{filteredOnus.length}</strong> of{' '}
            <strong className="text-slate-700">{totalCount}</strong> subscriber ONUs
          </div>
          <Button variant="secondary" onClick={() => setModalOpen('onuFleet', false)}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};
