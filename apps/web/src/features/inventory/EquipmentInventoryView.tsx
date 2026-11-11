import React, { useState } from 'react';
import { Camera, Download, MapPin, PlusCircle, Search, Trash2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { type Equipment, reportToCsv } from '@fibergis/shared';

import { useOpenView, useShowOnMap } from '../../app/views';
import { useMayDo } from '../../stores/authStore';
import { useMapStore } from '../../stores/mapStore';
import { deleteEquipment } from '../../stores/networkActions';
import { useNetworkStore } from '../../stores/networkStore';
import { useToastStore } from '../../stores/toastStore';
import { useUiStore } from '../../stores/uiStore';
import { type InventorySortKey, matchesInventorySearch, pageOf, type SortDirection, sortInventory } from './inventoryRows';

export const EquipmentInventoryView: React.FC = () => {
  // Phase 23: saving lists to a file is the export right.
  const mayExport = useMayDo('export');
  const equipments = useNetworkStore((s) => s.equipment);
  const { setSelectedObject, setModalOpen } = useUiStore(
    useShallow((s) => ({ setSelectedObject: s.select, setModalOpen: s.setModalOpen })),
  );
  const { setSelectedEquipmentTypeToAdd, setActiveTool } = useMapStore(
    useShallow((s) => ({ setSelectedEquipmentTypeToAdd: s.setEquipmentTypeToAdd, setActiveTool: s.setActiveTool })),
  );
  const showToast = useToastStore((s) => s.show);
  const openView = useOpenView();
  const showOnMap = useShowOnMap();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedStatus, setSelectedStatus] = useState<string>('All');
  const [selectedTechnology, setSelectedTechnology] = useState<'All' | 'GPON' | 'EPON'>('All');
  const [sortKey, setSortKey] = useState<InventorySortKey>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [page, setPage] = useState(0);

  // Filtered equipments
  const filteredEquipments = equipments.filter((eq) => {
    const matchesSearch = matchesInventorySearch(eq, searchQuery);

    const matchesCategory = selectedCategory === 'All' || eq.category === selectedCategory;
    const matchesStatus = selectedStatus === 'All' || eq.status === selectedStatus;
    const matchesTech =
      selectedTechnology === 'All' || (eq.type === 'OLT' && (eq.technology || 'GPON') === selectedTechnology);

    return matchesSearch && matchesCategory && matchesStatus && matchesTech;
  });
  // Phase 2: sorted, and shown a page at a time. The CSV export still takes every filtered row.
  const sorted = sortInventory(filteredEquipments, sortKey, sortDirection);
  const shown = pageOf(sorted, page);
  const sortBy = (key: InventorySortKey) => {
    if (key === sortKey) setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDirection('asc');
    }
    setPage(0);
  };
  const sortHeader = (key: InventorySortKey, text: string) => (
    <button type="button" onClick={() => sortBy(key)} className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-slate-800" data-testid={`inv-sort-${key}`} aria-label={`Sort by ${text}`}>
      {text}
      <span aria-hidden className="text-slate-400">{sortKey === key ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}</span>
    </button>
  );

  // Export to CSV
  const handleExportCSV = () => {
    // A blank cell means not recorded. Every cell is escaped and kept safe from spreadsheet formulas.
    const columns = [
      ['id', 'ID'],
      ['name', 'Name'],
      ['type', 'Type'],
      ['category', 'Category'],
      ['area', 'Area'],
      ['street', 'Street'],
      ['status', 'Status'],
      ['totalPorts', 'Total Ports'],
      ['usedPorts', 'Used Ports'],
      ['manufacturer', 'Manufacturer'],
      ['installedDate', 'Installed Date'],
      ['lat', 'Latitude'],
      ['lng', 'Longitude'],
    ].map(([key, label]) => ({ key, label }));
    const rows = filteredEquipments.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      category: e.category,
      area: e.area,
      street: e.street,
      status: e.status,
      totalPorts: e.totalPorts ?? '',
      usedPorts: e.usedPorts ?? '',
      manufacturer: e.manufacturer ?? '',
      installedDate: e.installedDate,
      lat: e.lat,
      lng: e.lng,
    }));

    const csvContent = reportToCsv({ columns, rows });
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `equipment_inventory_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('success', 'Export Complete', `Exported ${filteredEquipments.length} equipment records to CSV.`);
  };

  const handleLocateOnMap = (eq: Equipment) => showOnMap({ type: 'equipment', data: eq });

  const handleOpenTerminalBox = (eq: Equipment) => {
    setSelectedObject({ type: 'equipment', data: eq });
    setModalOpen('terminalBox', true);
  };

  // KPI Metrics
  const totalCount = equipments.length;
  const centralOfficeCount = equipments.filter((e) => e.category === 'Central Office').length;
  const distributionCount = equipments.filter((e) => e.category === 'Fiber Distribution').length;
  const civilCount = equipments.filter((e) => e.category === 'Supporting Infrastructure').length;
  const faultCount = equipments.filter((e) => e.status === 'Faulty' || e.status === 'Warning').length;

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 overflow-hidden select-none">
      {/* Top Header */}
      <div className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0 shadow-xs z-10">
        <div>
          <h2 className="text-base font-bold text-slate-800">Equipment & Physical Asset Inventory</h2>
          <p className="text-xs text-slate-500">
            Comprehensive directory of central office, distribution, civil, and customer assets
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleExportCSV}
            hidden={!mayExport}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-lg text-xs font-semibold shadow-2xs transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Export CSV</span>
          </button>

          <button
            onClick={() => {
              setActiveTool('add_equipment');
              setSelectedEquipmentTypeToAdd('FAT');
              openView('map');
            }}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Add Equipment</span>
          </button>
        </div>
      </div>

      {/* KPI Stats Ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-4 bg-slate-100/70 border-b border-slate-200/80 shrink-0">
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-[11px] font-bold text-slate-400 uppercase">Total Equipment</div>
          <div className="text-xl font-extrabold text-slate-900 mt-0.5">{totalCount}</div>
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-[11px] font-bold text-blue-600 uppercase">Central Office</div>
          <div className="text-xl font-extrabold text-blue-700 mt-0.5">{centralOfficeCount}</div>
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-[11px] font-bold text-indigo-600 uppercase">Fiber Distribution</div>
          <div className="text-xl font-extrabold text-indigo-700 mt-0.5">{distributionCount}</div>
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-[11px] font-bold text-amber-600 uppercase">Poles & Chambers</div>
          <div className="text-xl font-extrabold text-amber-700 mt-0.5">{civilCount}</div>
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
          <div className="text-[11px] font-bold text-rose-600 uppercase">Faulty / Warning</div>
          <div className="text-xl font-extrabold text-rose-700 mt-0.5">{faultCount}</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-4 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 flex-1 max-w-xl">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filter by ID, name, area, make, model, serial or tag..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(0); }}
              className="w-full pl-9 pr-3 py-1.5 bg-slate-100 hover:bg-slate-200/80 focus:bg-white border border-slate-200 focus:border-blue-500 rounded-lg text-xs outline-none transition-all"
            />
          </div>

          {/* Category Filter */}
          <select
            value={selectedCategory}
            onChange={(e) => { setSelectedCategory(e.target.value); setPage(0); }}
            className="px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 outline-none"
          >
            <option value="All">All Categories</option>
            <option value="Central Office">Central Office</option>
            <option value="Fiber Distribution">Fiber Distribution</option>
            <option value="Supporting Infrastructure">Supporting Civil</option>
            <option value="Customer Equipment">Customer ONT</option>
            <option value="Cable TV Infrastructure">Cable TV HFC</option>
          </select>

          {/* Status Filter */}
          <select
            value={selectedStatus}
            onChange={(e) => { setSelectedStatus(e.target.value); setPage(0); }}
            className="px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 outline-none"
          >
            <option value="All">All Statuses</option>
            <option value="Active">Active</option>
            <option value="Warning">Warning</option>
            <option value="Faulty">Faulty</option>
            <option value="Maintenance">Maintenance</option>
          </select>

          {/* OLT Technology Filter */}
          <select
            value={selectedTechnology}
            onChange={(e) => setSelectedTechnology(e.target.value as any)}
            className="px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 outline-none"
          >
            <option value="All">All PON Standards</option>
            <option value="GPON">🔵 OLT: GPON Only</option>
            <option value="EPON">🟣 OLT: EPON Only</option>
          </select>
        </div>

        <span className="text-xs text-slate-500 font-medium">
          Showing <span className="font-bold text-slate-800">{filteredEquipments.length}</span> of {totalCount} records
        </span>
      </div>

      {/* Main Table Area */}
      <div className="flex-1 overflow-auto p-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-bold text-[11px] uppercase tracking-wider">
                <th className="py-3 px-4">{sortHeader('name', 'Asset ID & Name')}</th>
                <th className="py-3 px-4">{sortHeader('type', 'Type & Category')}</th>
                <th className="py-3 px-4">{sortHeader('model', 'Make & model')}</th>
                <th className="py-3 px-4">Area & Street</th>
                <th className="py-3 px-4">{sortHeader('status', 'Status')}</th>
                <th className="py-3 px-4">Port Capacity</th>
                <th className="py-3 px-4">{sortHeader('installedDate', 'Installed Date')}</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.rows.map((eq) => {
                // Only what is recorded. No port count or use is filled in from the type.
                const totalPorts = eq.totalPorts ?? 0;
                const usedPorts = eq.usedPorts;
                const portPct = totalPorts > 0 && usedPorts !== undefined ? Math.round((usedPorts / totalPorts) * 100) : 0;

                return (
                  <tr key={eq.id} className="hover:bg-slate-50/80 transition-colors group">
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                        {eq.name}
                      </div>
                      <div className="text-[10px] font-mono text-slate-400">{eq.id}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-slate-700">{eq.type}</span>
                        {eq.type === 'OLT' && (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold uppercase border ${
                              (eq.technology || 'GPON') === 'EPON'
                                ? 'bg-purple-100 text-purple-700 border-purple-200'
                                : 'bg-blue-100 text-blue-700 border-blue-200'
                            }`}
                          >
                            {eq.technology || 'GPON'}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400">{eq.category}</div>
                    </td>
                    <td className="py-3 px-4">
                      {eq.manufacturer || eq.model ? (
                        <div className="text-slate-800 font-medium">{[eq.manufacturer, eq.model].filter(Boolean).join(' ')}</div>
                      ) : (
                        <span className="text-slate-400 text-[11px]">Not recorded</span>
                      )}
                      {eq.serialNumber && <div className="text-[10px] font-mono text-slate-400">SN {eq.serialNumber}</div>}
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-slate-800 font-medium">{eq.area}</div>
                      <div className="text-[10px] text-slate-400 truncate max-w-xs">{eq.street}</div>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          eq.status === 'Active'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : eq.status === 'Faulty'
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${eq.status === 'Active' ? 'bg-emerald-500' : 'bg-rose-500'}`}
                        />
                        {eq.status}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {totalPorts > 0 && usedPorts === undefined ? (
                        <span className="text-slate-500 text-[11px]">{totalPorts} ports · use not recorded</span>
                      ) : totalPorts > 0 && usedPorts !== undefined ? (
                        <div className="w-28">
                          <div className="flex justify-between text-[10px] mb-1">
                            <span className="font-semibold text-slate-700">
                              {usedPorts}/{totalPorts}
                            </span>
                            <span className="text-slate-400">{portPct}%</span>
                          </div>
                          <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${portPct > 85 ? 'bg-rose-500' : 'bg-blue-600'}`}
                              style={{ width: `${portPct}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-400 text-[11px]">Not recorded</span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-500 text-[11px]">
                      {eq.installedDate || <span className="font-sans text-slate-400">Not recorded</span>}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleLocateOnMap(eq)}
                          className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Locate on Map"
                        >
                          <MapPin className="w-3.5 h-3.5" />
                        </button>

                        {(eq.type === 'FAT' || eq.type.includes('Terminal Box') || eq.type === 'FDT') && (
                          <button
                            onClick={() => handleOpenTerminalBox(eq)}
                            className="p-1.5 text-slate-500 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                            title="Inspect Terminal Box & Photos"
                          >
                            <Camera className="w-3.5 h-3.5" />
                          </button>
                        )}

                        <button
                          onClick={() => void deleteEquipment(eq.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                          title="Delete Equipment"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {shown.pages > 1 && (
            <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-2 text-xs text-slate-600" data-testid="inv-pager">
              <span>
                Page {shown.page + 1} of {shown.pages} · {sorted.length} items
              </span>
              <div className="flex gap-2">
                <button type="button" disabled={shown.page === 0} onClick={() => setPage(shown.page - 1)} className="min-h-9 rounded-lg border border-slate-200 px-3 font-semibold disabled:opacity-40" data-testid="inv-prev">
                  Previous
                </button>
                <button type="button" disabled={shown.page >= shown.pages - 1} onClick={() => setPage(shown.page + 1)} className="min-h-9 rounded-lg border border-slate-200 px-3 font-semibold disabled:opacity-40" data-testid="inv-next">
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
