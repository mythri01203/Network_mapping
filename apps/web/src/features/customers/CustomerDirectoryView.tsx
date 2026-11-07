import React, { useState } from 'react';
import { Download, MapPin, PlusCircle, Radio, Route, Search } from 'lucide-react';

import { type Customer, hasRecordedLocation, rxReadingOf } from '@fibergis/shared';

import { useShowOnMap } from '../../app/views';
import { selectOpticalSettings, useNetworkStore } from '../../stores/networkStore';
import { useToastStore } from '../../stores/toastStore';
import { useUiStore } from '../../stores/uiStore';

export const CustomerDirectoryView: React.FC = () => {
  const customers = useNetworkStore((s) => s.customers);
  const optical = useNetworkStore(selectOpticalSettings);
  const setModalOpen = useUiStore((s) => s.setModalOpen);
  const openFiberTrace = useUiStore((s) => s.openFiberTrace);
  const showToast = useToastStore((s) => s.show);
  const showOnMap = useShowOnMap();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedService, setSelectedService] = useState<string>('All');
  const [selectedStatus, setSelectedStatus] = useState<string>('All');

  // Filtered subscribers
  const filteredCustomers = customers.filter((c) => {
    const matchesSearch =
      searchQuery === '' ||
      c.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.mobile.includes(searchQuery) ||
      (c.ontSerialNumber || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.ipAddress.includes(searchQuery) ||
      c.terminalBoxId.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesService = selectedService === 'All' || c.serviceType === selectedService;
    const matchesStatus = selectedStatus === 'All' || c.status === selectedStatus;

    return matchesSearch && matchesService && matchesStatus;
  });

  const handleLocateOnMap = (customer: Customer) => showOnMap({ type: 'customer', data: customer });

  const handleExportCSV = () => {
    const headers = [
      'Customer ID',
      'Name',
      'Mobile',
      'Address',
      'Area',
      'Service Plan',
      'Status',
      'OLT ID',
      'PON Port',
      'FAT Terminal Box',
      'Splitter Port',
      'ONT Serial',
      'IP Address',
      'Rx Optical Power dBm',
      'Rx Origin',
      'Rx Read At',
    ];
    const rows = filteredCustomers.map((c) => [
      c.id,
      `"${c.name}"`,
      `"${c.mobile}"`,
      `"${c.address}"`,
      `"${c.area}"`,
      `"${c.plan}"`,
      c.status,
      c.oltId,
      c.ponPort,
      c.terminalBoxId,
      c.splitterOutputPort,
      c.ontSerialNumber,
      c.ipAddress,
      rxReadingOf(c, optical).valueDbm ?? '',
      rxReadingOf(c, optical).originLabel,
      rxReadingOf(c, optical).measuredAt ?? '',
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `customer_directory_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('success', 'Subscribers Exported', `Exported ${filteredCustomers.length} customer records to CSV.`);
  };

  // KPIs
  const totalSubscribers = customers.length;
  const activeSubs = customers.filter((c) => c.status === 'Active').length;
  const fiberSubs = customers.filter(
    (c) => c.serviceType === 'Fiber Broadband' || c.serviceType === 'Triple Play',
  ).length;
  const catvSubs = customers.filter((c) => c.serviceType === 'Cable TV').length;
  const isLowReading = (c: Customer) => {
    const { band } = rxReadingOf(c, optical);
    return band === 'low_margin' || band === 'bad';
  };
  const lowSignalSubs = customers.filter(isLowReading).length;

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 overflow-hidden select-none">
      {/* Top Header */}
      <div className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0 shadow-xs z-10">
        <div>
          <h2 className="text-base font-bold text-slate-800">Customer & Subscriber Directory</h2>
          <p className="text-xs text-slate-500">
            FTTH broadband, Triple Play and Cable TV subscribers. No live connection: readings are saved records.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setModalOpen('onuFleet', true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-50 hover:bg-sky-100 border border-sky-200 text-sky-700 rounded-lg text-xs font-semibold shadow-2xs transition-colors"
          >
            <Radio className="w-3.5 h-3.5 text-sky-600" />
            <span>ONU Fleet Manager</span>
          </button>

          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-lg text-xs font-semibold shadow-2xs transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Export CSV</span>
          </button>

          <button
            onClick={() => setModalOpen('customerWizard', true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Onboard Customer Wizard</span>
          </button>
        </div>
      </div>

      {/* KPI Stats Ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-4 bg-slate-100/70 border-b border-slate-200/80 shrink-0">
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-[11px] font-bold text-slate-400 uppercase">Total Subscribers</div>
          <div className="text-xl font-extrabold text-slate-900 mt-0.5">{totalSubscribers}</div>
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-[11px] font-bold text-emerald-600 uppercase">Active Connections</div>
          <div className="text-xl font-extrabold text-emerald-700 mt-0.5">{activeSubs}</div>
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-[11px] font-bold text-blue-600 uppercase">FTTH Broadband</div>
          <div className="text-xl font-extrabold text-blue-700 mt-0.5">{fiberSubs}</div>
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-[11px] font-bold text-orange-600 uppercase">Cable TV (CATV)</div>
          <div className="text-xl font-extrabold text-orange-700 mt-0.5">{catvSubs}</div>
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-[11px] font-bold text-rose-600 uppercase">
            Low Rx (&lt; {optical.rx.goodFloorDbm} dBm, measured or estimated)
          </div>
          <div className="text-xl font-extrabold text-rose-700 mt-0.5">{lowSignalSubs}</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-4 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 flex-1 max-w-xl">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by name, ID, mobile, ONT serial, or IP..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-slate-100 hover:bg-slate-200/80 focus:bg-white border border-slate-200 focus:border-blue-500 rounded-lg text-xs outline-none transition-all"
            />
          </div>

          <select
            value={selectedService}
            onChange={(e) => setSelectedService(e.target.value)}
            className="px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 outline-none"
          >
            <option value="All">All Services</option>
            <option value="Fiber Broadband">Fiber Broadband</option>
            <option value="Triple Play">Triple Play</option>
            <option value="Cable TV">Cable TV</option>
            <option value="Enterprise Fiber">Enterprise Fiber</option>
          </select>

          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 outline-none"
          >
            <option value="All">All Statuses</option>
            <option value="Active">Active</option>
            <option value="Suspended">Suspended</option>
            <option value="Disconnected">Disconnected</option>
          </select>
        </div>

        <span className="text-xs text-slate-500 font-medium">
          Showing <span className="font-bold text-slate-800">{filteredCustomers.length}</span> of {totalSubscribers}{' '}
          subscribers
        </span>
      </div>

      {/* Main Customers Table */}
      <div className="flex-1 overflow-auto p-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-bold text-[11px] uppercase tracking-wider">
                <th className="py-3 px-4">Subscriber</th>
                <th className="py-3 px-4">Service & Plan</th>
                <th className="py-3 px-4">Physical Path (OLT &rarr; FAT)</th>
                <th className="py-3 px-4">Device (ONT / IP)</th>
                <th className="py-3 px-4">Rx Optical Power</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredCustomers.map((c) => {
                const reading = rxReadingOf(c, optical);
                const dot =
                  reading.band === 'good'
                    ? 'bg-emerald-500'
                    : reading.band === 'unknown'
                      ? 'bg-slate-300'
                      : reading.band === 'low_margin'
                        ? 'bg-amber-500'
                        : 'bg-rose-500';
                const text =
                  reading.band === 'good'
                    ? 'text-emerald-700'
                    : reading.band === 'unknown'
                      ? 'text-slate-500'
                      : reading.band === 'low_margin'
                        ? 'text-amber-700'
                        : 'text-rose-600';

                return (
                  <tr key={c.id} className="hover:bg-slate-50/80 transition-colors group">
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                        {c.name}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {c.id} &bull; {c.mobile}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-800">{c.plan}</div>
                      <div className="text-[10px] text-blue-600 font-medium">{c.serviceType}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-mono text-[11px] text-slate-700">
                        {c.oltId ? (
                          <>
                            {c.oltId} &bull; {c.ponPort || 'Port not recorded'}
                          </>
                        ) : (
                          <span className="font-semibold text-amber-700">Not linked</span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Box: <span className="font-semibold text-slate-600">{c.terminalBoxId}</span> (Port{' '}
                        {c.splitterOutputPort})
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-mono text-slate-700 font-semibold">{c.ontSerialNumber || 'Not recorded'}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{c.ipAddress || 'IP not recorded'}</div>
                      {!hasRecordedLocation(c) && (
                        <div className="text-[10px] font-semibold text-amber-700">House location not recorded</div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${dot}`} />
                        <span className={`font-mono font-bold ${text}`}>
                          {reading.valueDbm !== undefined ? `${reading.valueDbm.toFixed(1)} dBm` : 'Not recorded'}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {reading.valueDbm !== undefined ? `${reading.originLabel} · ${reading.bandLabel}` : 'No reading saved'}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          c.status === 'Active'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => openFiberTrace(c.id)}
                          className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Trace Complete Fiber Path & Loss Budget"
                        >
                          <Route className="w-3.5 h-3.5" />
                        </button>

                        <button
                          onClick={() => handleLocateOnMap(c)}
                          className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                          title="Locate Customer on Map"
                        >
                          <MapPin className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
