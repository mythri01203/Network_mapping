import React, { useState } from 'react';
import { useNetwork } from '../../context/NetworkContext';
import { type UserRole } from '../../types/network';
import { STANDARD_12_COLORS, type FiberColorDef } from '../../constants/colorStandards';
import { Download, Upload, Search, Check, X, Layers } from 'lucide-react';

export const AdminConfigView: React.FC = () => {
  const { userRole, auditLogs, backupSystem, restoreSystem, exportKML } = useNetwork();

  const [activeTab, setActiveTab] = useState<'roles' | 'color_standards' | 'audit_logs' | 'backup'>('roles');
  const [auditSearch, setAuditSearch] = useState('');

  const permissionsList = [
    { key: 'view_gis', label: 'View Leaflet GIS Network Map' },
    { key: 'add_equipment', label: 'Add & Configure Network Equipment' },
    { key: 'draw_cables', label: 'Draw Fiber Cables & Manage Routes' },
    { key: 'splicing', label: 'Core Allocation & Fusion Splicing Matrix' },
    { key: 'customer_onboard', label: 'Customer Subscriber Connection Wizard' },
    { key: 'outage_mgmt', label: 'Log & Resolve Network Faults' },
    { key: 'photo_upload', label: 'Upload Field Photos & Port Markings' },
    { key: 'reports_export', label: 'Generate Reports (PDF, CSV, GeoJSON, KML)' },
    { key: 'sys_admin', label: 'System Configuration & Database Backup/Restore' },
  ];

  const rolePermissions: Record<UserRole, Record<string, boolean>> = {
    Administrator: {
      view_gis: true,
      add_equipment: true,
      draw_cables: true,
      splicing: true,
      customer_onboard: true,
      outage_mgmt: true,
      photo_upload: true,
      reports_export: true,
      sys_admin: true,
    },
    'Network Engineer': {
      view_gis: true,
      add_equipment: true,
      draw_cables: true,
      splicing: true,
      customer_onboard: true,
      outage_mgmt: true,
      photo_upload: true,
      reports_export: true,
      sys_admin: false,
    },
    'Network Operator': {
      view_gis: true,
      add_equipment: false,
      draw_cables: false,
      splicing: false,
      customer_onboard: true,
      outage_mgmt: true,
      photo_upload: true,
      reports_export: true,
      sys_admin: false,
    },
    'Field Technician': {
      view_gis: true,
      add_equipment: false,
      draw_cables: false,
      splicing: true,
      customer_onboard: false,
      outage_mgmt: true,
      photo_upload: true,
      reports_export: false,
      sys_admin: false,
    },
    Supervisor: {
      view_gis: true,
      add_equipment: false,
      draw_cables: false,
      splicing: false,
      customer_onboard: false,
      outage_mgmt: false,
      photo_upload: false,
      reports_export: true,
      sys_admin: false,
    },
  };

  const filteredLogs = auditLogs.filter(
    (log) =>
      auditSearch === '' ||
      log.action.toLowerCase().includes(auditSearch.toLowerCase()) ||
      log.details.toLowerCase().includes(auditSearch.toLowerCase()) ||
      log.assetId.toLowerCase().includes(auditSearch.toLowerCase()) ||
      log.user.toLowerCase().includes(auditSearch.toLowerCase()),
  );

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        restoreSystem(content);
      };
      reader.readAsText(file);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 overflow-hidden select-none">
      {/* Top Header */}
      <div className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0 shadow-xs z-10">
        <div>
          <h2 className="text-base font-bold text-slate-800">System Administration & Global Configuration</h2>
          <p className="text-xs text-slate-500">
            RBAC role matrix, 12-fiber color code standards, audit logs, and database backup
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('roles')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              activeTab === 'roles' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            User Roles & RBAC
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
        {activeTab === 'roles' && (
          <div className="max-w-5xl mx-auto space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-sm font-bold text-slate-800">Role-Based Access Control (RBAC) Matrix</h3>
                <p className="text-xs text-slate-500">
                  Configured permissions for telecom operators, field technicians, and engineers
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-500">Current Active Role:</span>
                <span className="font-bold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-md border border-blue-200">
                  {userRole}
                </span>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 text-[11px] uppercase font-bold">
                    <th className="py-3 px-4">Permission Module</th>
                    <th className="py-3 px-3 text-center">Administrator</th>
                    <th className="py-3 px-3 text-center">Network Engineer</th>
                    <th className="py-3 px-3 text-center">Network Operator</th>
                    <th className="py-3 px-3 text-center">Field Technician</th>
                    <th className="py-3 px-3 text-center">Supervisor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {permissionsList.map((perm) => (
                    <tr key={perm.key} className="hover:bg-slate-50/60">
                      <td className="py-3 px-4 font-semibold text-slate-800">{perm.label}</td>
                      {(
                        [
                          'Administrator',
                          'Network Engineer',
                          'Network Operator',
                          'Field Technician',
                          'Supervisor',
                        ] as UserRole[]
                      ).map((r) => {
                        const allowed = rolePermissions[r][perm.key];
                        return (
                          <td key={r} className="py-3 px-3 text-center">
                            {allowed ? (
                              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200">
                                <Check className="w-3 h-3 stroke-[3]" />
                              </span>
                            ) : (
                              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-50 text-slate-300">
                                <X className="w-3 h-3" />
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 2: Color Standards */}
        {activeTab === 'color_standards' && (
          <div className="max-w-5xl mx-auto space-y-6">
            <div>
              <h3 className="text-sm font-bold text-slate-800">TIA-598-C Standard 12-Fiber Color Code Sequence</h3>
              <p className="text-xs text-slate-500">
                Universal standard for optical fiber and buffer tube identification in FTTH and trunk cables
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
              {/* JSON Backup Card */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs flex flex-col justify-between">
                <div>
                  <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mb-3">
                    <Download className="w-5 h-5" />
                  </div>
                  <h4 className="font-bold text-sm text-slate-800">Export Complete JSON Backup</h4>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Downloads all equipment, fiber cables, splitters, joint closures, subscriber paths, faults, and
                    zones in structured JSON.
                  </p>
                </div>
                <button
                  onClick={backupSystem}
                  className="mt-6 w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors flex items-center justify-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Backup File</span>
                </button>
              </div>

              {/* Restore Card */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs flex flex-col justify-between">
                <div>
                  <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center mb-3">
                    <Upload className="w-5 h-5" />
                  </div>
                  <h4 className="font-bold text-sm text-slate-800">Restore System from JSON</h4>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Import a previously exported backup file to restore complete network configuration.
                  </p>
                </div>
                <label className="mt-6 w-full py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Choose JSON Backup File</span>
                  <input type="file" accept=".json" onChange={handleFileUpload} className="hidden" />
                </label>
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
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
