import React, { useState } from 'react';
import { Download, Layers, Search, Upload } from 'lucide-react';

import { type FiberColorDef, STANDARD_12_COLORS } from '@fibergis/shared';

import { exportKML } from '../../stores/networkActions';
import { useNetworkStore } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';
import { BackupRestorePanel } from '../admin/BackupRestorePanel';
import { FaultSettingsPanel, FieldSettingsPanel, MonitoringSettingsPanel, OspSettingsPanel } from '../admin/FieldSettingsPanel';
import { OpticalSettingsPanel } from '../admin/OpticalSettingsPanel';
import { RfSettingsPanel } from '../admin/RfSettingsPanel';
import { UsersPanel } from '../admin/UsersPanel';

export const AdminConfigView: React.FC = () => {
  const auditLogs = useNetworkStore((s) => s.auditLogs);

  const [activeTab, setActiveTab] = useState<'roles' | 'color_standards' | 'optical' | 'field' | 'routes' | 'faults' | 'monitoring' | 'cable_tv' | 'audit_logs' | 'backup'>('roles');
  const [auditSearch, setAuditSearch] = useState('');

  const filteredLogs = auditLogs.filter(
    (log) =>
      auditSearch === '' ||
      log.action.toLowerCase().includes(auditSearch.toLowerCase()) ||
      log.details.toLowerCase().includes(auditSearch.toLowerCase()) ||
      log.assetId.toLowerCase().includes(auditSearch.toLowerCase()) ||
      log.user.toLowerCase().includes(auditSearch.toLowerCase()),
  );

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 overflow-hidden select-none">
      {/* Top Header */}
      <div className="min-h-16 bg-white border-b border-slate-200 px-6 py-2 flex flex-wrap items-center justify-between gap-2 shrink-0 shadow-xs z-10">
        <div>
          <h2 className="text-base font-bold text-slate-800">System Administration & Global Configuration</h2>
          <p className="text-xs text-slate-500">
            Users and roles, 12-fiber color code standards, audit logs, and database backup
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('roles')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              activeTab === 'roles' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Users and roles
          </button>
          <button
            onClick={() => setActiveTab('color_standards')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              activeTab === 'color_standards'
                ? 'bg-white text-blue-700 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            12-Color Standards
          </button>
          <button
            onClick={() => setActiveTab('optical')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              activeTab === 'optical' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Optical settings
          </button>
          <button
            onClick={() => setActiveTab('field')}
            data-testid="admin-field-tab"
            className={`px-3 py-1.5 rounded-lg transition-all ${
              activeTab === 'field' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Field capture settings
          </button>
          <button
            onClick={() => setActiveTab('routes')}
            data-testid="admin-routes-tab"
            className={`px-3 py-1.5 rounded-lg transition-all ${
              activeTab === 'routes' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Poles and routes settings
          </button>
          <button
            onClick={() => setActiveTab('faults')}
            data-testid="admin-faults-tab"
            className={`px-3 py-1.5 rounded-lg transition-all ${
              activeTab === 'faults' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Fault checks settings
          </button>
          <button
            onClick={() => setActiveTab('monitoring')}
            data-testid="admin-monitoring-tab"
            className={`px-3 py-1.5 rounded-lg transition-all ${
              activeTab === 'monitoring' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Monitoring settings
          </button>
          <button
            onClick={() => setActiveTab('cable_tv')}
            data-testid="admin-cable-tv-tab"
            className={`px-3 py-1.5 rounded-lg transition-all ${
              activeTab === 'cable_tv' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Cable TV settings
          </button>
          <button
            onClick={() => setActiveTab('audit_logs')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              activeTab === 'audit_logs' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Audit Trail Logs ({auditLogs.length})
          </button>
          <button
            onClick={() => setActiveTab('backup')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              activeTab === 'backup' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Backup & KML
          </button>
        </div>
      </div>

      {/* Main Tab Views */}
      <div className="flex-1 overflow-auto p-6">
        {/* Tab 1: Roles Matrix */}
        {activeTab === 'roles' && <UsersPanel />}

        {/* Tab 2: Color Standards */}
        {activeTab === 'color_standards' && (
          <div className="max-w-5xl mx-auto space-y-6">
            <div>
              <h3 className="text-sm font-bold text-slate-800">TIA-598-C Standard 12-Fiber Color Code Sequence</h3>
              <p className="text-xs text-slate-500">
                Common but not universal: IEC schemes reorder it and makers differ on tube size and tube colours. A cable shows colours only when its scheme is recorded on it (Optical settings, Fiber colour schemes).
              </p>
            </div>

            {/* 12 Color Cards Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {STANDARD_12_COLORS.map((color: FiberColorDef) => (
                <div
                  key={color.number}
                  className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs flex flex-col items-center text-center"
                >
                  <div
                    className="w-10 h-10 rounded-full border-2 border-white shadow-md mb-2 flex items-center justify-center text-xs font-bold font-mono"
                    style={{
                      backgroundColor: color.hex,
                      color: color.name === 'White' || color.name === 'Yellow' ? '#1e293b' : '#ffffff',
                    }}
                  >
                    #{color.number.toString().padStart(2, '0')}
                  </div>
                  <div className="font-bold text-xs text-slate-800">{color.name}</div>
                  <div className="font-mono text-[10px] text-slate-400 mt-0.5">{color.hex}</div>
                </div>
              ))}
            </div>

            {/* Multi-Tube Math Calculation Card */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs">
              <h4 className="font-bold text-xs text-slate-800 uppercase mb-2">Multi-Tube Fiber Core Formula</h4>
              <p className="text-xs text-slate-600 leading-relaxed">
                In multi-tube cables (24F, 48F, 96F, 144F, 288F), buffer tubes follow the same 12-color sequence as
                individual fiber cores.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4 text-xs font-mono">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <div className="text-slate-400 text-[10px]">Tube Calculation</div>
                  <div className="text-blue-700 font-bold mt-1">Tube = ceil(Core / 12)</div>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <div className="text-slate-400 text-[10px]">Position Within Tube</div>
                  <div className="text-blue-700 font-bold mt-1">Pos = ((Core - 1) % 12) + 1</div>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <div className="text-slate-400 text-[10px]">Example (Core 38)</div>
                  <div className="text-emerald-700 font-bold mt-1">Tube 4 (Brown) &bull; Core 2 (Orange)</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'optical' && <OpticalSettingsPanel />}
        {activeTab === 'field' && <FieldSettingsPanel />}
        {activeTab === 'routes' && <OspSettingsPanel />}
        {activeTab === 'faults' && <FaultSettingsPanel />}
        {activeTab === 'monitoring' && <MonitoringSettingsPanel />}
        {activeTab === 'cable_tv' && <RfSettingsPanel />}

        {/* Tab 3: Audit Logs */}
        {activeTab === 'audit_logs' && (
          <div className="max-w-5xl mx-auto space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-sm font-bold text-slate-800">System Activity & Audit Trail</h3>
                <p className="text-xs text-slate-500">
                  Immutable ledger of equipment creation, splices, customer onboarding, and outages
                </p>
              </div>

              <div className="relative w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filter audit entries..."
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 text-[11px] uppercase font-bold">
                  <tr>
                    <th className="py-3 px-4">Timestamp</th>
                    <th className="py-3 px-4">User & Role</th>
                    <th className="py-3 px-4">Action</th>
                    <th className="py-3 px-4">Details</th>
                    <th className="py-3 px-4">Target Asset</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500">{log.timestamp}</td>
                      <td className="py-2.5 px-4">
                        <span className="font-bold text-slate-800">{log.user}</span>
                        <div className="text-[10px] text-blue-600">{log.role}</div>
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[11px] font-semibold text-slate-700">{log.action}</td>
                      <td className="py-2.5 px-4 text-slate-600">{log.details}</td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-blue-600 font-semibold">{log.assetId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 4: Backup & Export */}
        {activeTab === 'backup' && (
          <div className="max-w-3xl mx-auto space-y-6">
            <div>
              <h3 className="text-sm font-bold text-slate-800">Database Backup, Recovery & Geospatial Export</h3>
              <p className="text-xs text-slate-500">
                Safely backup entire network topology or export to Google Earth KML
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <BackupRestorePanel />
              </div>

              {/* Google Earth KML Card */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs flex flex-col justify-between md:col-span-2">
                <div>
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3">
                    <Layers className="w-5 h-5" />
                  </div>
                  <h4 className="font-bold text-sm text-slate-800">Export to Google Earth (.KML)</h4>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Generate standard OGC KML 2.2 vector file with all cable polylines, fiber route geometries, and
                    equipment placemarks ready to open in Google Earth Pro or handheld GPS devices.
                  </p>
                </div>
                <button
                  onClick={exportKML}
                  className="mt-6 w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors flex items-center justify-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Google Earth KML</span>
                </button>
                <button
                  onClick={() => useUiStore.getState().setModalOpen('kmlImport', true)}
                  data-testid="admin-kml-import"
                  className="mt-2 w-full py-2.5 bg-white border border-emerald-600 text-emerald-700 hover:bg-emerald-50 rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Import KML or KMZ (preview first)</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
