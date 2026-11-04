import React, { useState } from 'react';
import { deleteEquipment } from '../../stores/networkActions';
import { useShallow } from 'zustand/react/shallow';
import { useToastStore } from '../../stores/toastStore';
import { useMapStore } from '../../stores/mapStore';
import { useUiStore } from '../../stores/uiStore';
import { useNetworkStore } from '../../stores/networkStore';
import { useOpenView, useShowOnMap } from '../../app/views';
import type { Equipment } from '@fibergis/shared';
import { Search, Download, PlusCircle, MapPin, Trash2, Camera } from 'lucide-react';

export const EquipmentInventoryView: React.FC = () => {
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

  // Filtered equipments
  const filteredEquipments = equipments.filter((eq) => {
    const matchesSearch =
      searchQuery === '' ||
      eq.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      eq.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      eq.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
      eq.area.toLowerCase().includes(searchQuery.toLowerCase()) ||
      eq.street.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory = selectedCategory === 'All' || eq.category === selectedCategory;
    const matchesStatus = selectedStatus === 'All' || eq.status === selectedStatus;
    const matchesTech =
      selectedTechnology === 'All' || (eq.type === 'OLT' && (eq.technology || 'GPON') === selectedTechnology);

    return matchesSearch && matchesCategory && matchesStatus && matchesTech;
  });

  // Export to CSV
  const handleExportCSV = () => {
    const headers = [
      'ID',
      'Name',
      'Type',
      'Category',
      'Area',
      'Street',
      'Status',
      'Total Ports',
      'Used Ports',
      'Manufacturer',
      'Installed Date',
      'Latitude',
      'Longitude',
    ];
    const rows = filteredEquipments.map((e) => [
      e.id,
      `"${e.name}"`,
      e.type,
      e.category,
      `"${e.area}"`,
      `"${e.street}"`,
      e.status,
      e.totalPorts || 0,
      e.usedPorts || 0,
      e.manufacturer || 'N/A',
      e.installedDate,
      e.lat,
      e.lng,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
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
              placeholder="Filter by ID, name, area, street, or model..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-slate-100 hover:bg-slate-200/80 focus:bg-white border border-slate-200 focus:border-blue-500 rounded-lg text-xs outline-none transition-all"
            />
          </div>

          {/* Category Filter */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
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
            onChange={(e) => setSelectedStatus(e.target.value)}
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
                <th className="py-3 px-4">Asset ID & Name</th>
                <th className="py-3 px-4">Type & Category</th>
                <th className="py-3 px-4">Area & Street</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Port Capacity</th>
                <th className="py-3 px-4">Installed Date</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredEquipments.map((eq) => {
                const totalPorts = eq.totalPorts || (eq.type === 'FAT' ? 8 : eq.type === 'FDT' ? 48 : 0);
                const usedPorts = eq.usedPorts || (eq.type === 'FAT' ? 5 : eq.type === 'FDT' ? 24 : 0);
                const portPct = totalPorts > 0 ? Math.round((usedPorts / totalPorts) * 100) : 0;

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
                      {totalPorts > 0 ? (
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
                        <span className="text-slate-400 text-[11px]">N/A</span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-500 text-[11px]">
                      {eq.installedDate || '2026-01-15'}
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
                          onClick={() => deleteEquipment(eq.id)}
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
        </div>
      </div>
    </div>
  );
};
