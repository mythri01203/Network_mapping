import React, { useState } from 'react';
import jsPDF from 'jspdf';
import { Download, FileSpreadsheet, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { coreIdentity, effectiveCoreStatus, rxReadingOf } from '@fibergis/shared';

import { selectColorSchemes, useNetworkStore } from '../../stores/networkStore';
import { useToastStore } from '../../stores/toastStore';
import { useUiStore } from '../../stores/uiStore';

export const ReportsModal: React.FC = () => {
  const { isReportsModalOpen, setModalOpen } = useUiStore(
    useShallow((s) => ({ isReportsModalOpen: s.modals.reports, setModalOpen: s.setModalOpen })),
  );
  const { equipments, cables, customers, faults: allFaults } = useNetworkStore(
    useShallow((s) => ({ equipments: s.equipment, cables: s.cables, customers: s.customers, faults: s.faults })),
  );
  const showToast = useToastStore((s) => s.show);

  const [selectedReport, setSelectedReport] = useState<'inventory' | 'cores' | 'customers' | 'faults'>('inventory');
  /** TEST faults are left out of reports unless asked for (Phase 8). */
  const [includeTests, setIncludeTests] = useState(false);
  const testCount = allFaults.filter((f) => f.isTest).length;
  const faults = includeTests ? allFaults : allFaults.filter((f) => !f.isTest);

  if (!isReportsModalOpen) return null;

  // Export CSV
  const exportCSV = (type: string) => {
    let csvContent = 'data:text/csv;charset=utf-8,';
    const filename = `fiber_gis_${type}_${Date.now()}.csv`;

    if (type === 'inventory') {
      csvContent += 'Equipment ID,Name,Type,Category,Area,Street,Status,Ports,Installed Date\n';
      equipments.forEach((e) => {
        csvContent += `"${e.id}","${e.name}","${e.type}","${e.category}","${e.area}","${e.street}","${e.status}","${e.totalPorts || 0}","${e.installedDate}"\n`;
      });
    } else if (type === 'cores') {
      csvContent += 'Cable ID,Cable Name,Core Number,Tube,Color,Status,Connected Target,Attenuation dB,Remarks\n';
      cables.forEach((c) => {
        const schemes = selectColorSchemes(useNetworkStore.getState());
        c.cores.forEach((core) => {
          const id = coreIdentity(c, core.coreNumber, schemes);
          csvContent += `"${c.id}","${c.name}","${core.coreNumber}","${id.tubeNumber ?? 'Not recorded'}","${id.fiberColor?.name ?? 'Not known'}","${effectiveCoreStatus(core)}","${core.connectedToEquipmentId || core.customerId || 'Free'}","${core.attenuationDb || ''}","${core.remarks}"\n`;
        });
      });
    } else if (type === 'customers') {
      csvContent +=
        'Customer ID,Name,Mobile,Address,Area,Plan,Terminal Box,Splitter,Port,ONT Serial,IP Address,Rx Power dBm,Rx Origin\n';
      customers.forEach((cu) => {
        csvContent += `"${cu.id}","${cu.name}","${cu.mobile}","${cu.address}","${cu.area}","${cu.plan}","${cu.terminalBoxId}","${cu.splitterId}","${cu.splitterOutputPort}","${cu.ontSerialNumber}","${cu.ipAddress}","${rxReadingOf(cu).valueDbm ?? ''}","${rxReadingOf(cu).originLabel}"\n`;
      });
    } else if (type === 'faults') {
      csvContent += 'Fault ID,TEST,Source,Type,Severity,Status,Reported At,Description,Affected Customers,May Be Affected (path not fully recorded),Check\n';
      faults.forEach((f) => {
        csvContent += `"${f.id}","${f.isTest ? 'TEST' : ''}","${f.source ?? 'not recorded'}","${f.type}","${f.severity}","${f.status}","${f.reportedAt}","${f.description}","${f.affectedCustomerIds.join(';')}","${(f.mayBeAffectedCustomerIds ?? []).join(';')}","${f.verification?.method ?? ''}"\n`;
      });
    }

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('success', 'CSV Report Exported', `Downloaded ${filename}`);
  };

  // Export PDF using jsPDF
  const exportPDF = (type: string) => {
    const doc = new jsPDF();
    const now = new Date().toLocaleString();

    // Document Header
    doc.setFontSize(18);
    doc.setTextColor(2, 132, 199);
    doc.text('FIBER-GIS INFRASTRUCTURE REPORT', 14, 20);

    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text(`Generated on: ${now} | Operator: Certified Network Engineer`, 14, 27);
    doc.text(`Platform: Enterprise Optical GIS Network Management Platform`, 14, 32);

    doc.setDrawColor(226, 232, 240);
    doc.line(14, 36, 196, 36);

    let y = 45;

    if (type === 'inventory') {
      doc.setFontSize(14);
      doc.setTextColor(30, 41, 59);
      doc.text('Equipment & Asset Inventory Summary', 14, y);
      y += 8;

      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      equipments.slice(0, 20).forEach((eq, idx) => {
        if (y > 270) {
          doc.addPage();
          y = 20;
        }
        doc.text(`${idx + 1}. [${eq.id}] ${eq.name} — ${eq.type} (${eq.area}) | Status: ${eq.status}`, 14, y);
        y += 6;
      });
    } else if (type === 'customers') {
      doc.setFontSize(14);
      doc.setTextColor(30, 41, 59);
      doc.text('FTTH Customer Subscriber Connectivity Directory', 14, y);
      y += 8;

      doc.setFontSize(9);
      customers.slice(0, 20).forEach((cu, idx) => {
        if (y > 270) {
          doc.addPage();
          y = 20;
        }
        doc.text(
          `${idx + 1}. [${cu.id}] ${cu.name} — ${cu.plan} | FAT: ${cu.terminalBoxId} Port ${cu.splitterOutputPort} | Rx: ${rxReadingOf(cu).text}`,
          14,
          y,
        );
        y += 6;
      });
    }

    doc.save(`fiber_gis_${type}_report.pdf`);
    showToast('success', 'PDF Report Generated', `Downloaded fiber_gis_${type}_report.pdf`);
  };

  // Export GeoJSON
  const exportGeoJSON = () => {
    const geojson = {
      type: 'FeatureCollection',
      features: [
        ...equipments.map((e) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [e.lng, e.lat] },
          properties: { id: e.id, name: e.name, type: e.type, category: e.category, status: e.status, area: e.area },
        })),
        ...cables.map((c) => ({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: c.coordinates.map((pt) => [pt[1], pt[0]]) },
          properties: { id: c.id, name: c.name, type: c.type, fiberCount: c.fiberCount, lengthMeters: c.lengthMeters },
        })),
      ],
    };

    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `fiber_gis_network_${Date.now()}.geojson`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('success', 'GeoJSON Exported', 'Downloaded GIS FeatureCollection');
  };

  return (
    <div className="modal-sheet fixed inset-0 z-[1000] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in select-none">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shadow-xs">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-sm text-slate-900">Network Reports & GIS Data Export</h2>
              <p className="text-[11px] text-slate-500">
                Generate executive PDF, Excel CSV, and standard GeoJSON GIS layers
              </p>
            </div>
          </div>
          <button
            onClick={() => setModalOpen('reports', false)}
            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            {[
              {
                id: 'inventory',
                title: 'Equipment & Hardware Inventory',
                desc: 'Central Office OLTs, FDMS, FDTs, FATs, Poles, and Chambers',
                count: `${equipments.length} Assets`,
              },
              {
                id: 'cores',
                title: 'Fiber Core Availability Report',
                desc: 'Detailed 12-color code core-by-core status & free leads',
                count: `${cables.reduce((a, c) => a + c.fiberCount, 0)} Total Cores`,
              },
              {
                id: 'customers',
                title: 'Customer Subscriber Directory',
                desc: 'ONT serial numbers, assigned splitter ports, and optical power levels',
                count: `${customers.length} Subscribers`,
              },
              {
                id: 'faults',
                title: 'Network Outages & Outage History',
                desc: 'Active critical fiber cuts, affected downstream subscribers, work orders',
                count: `${faults.length} Recorded${!includeTests && testCount > 0 ? ` (${testCount} TEST left out)` : ''}`,
              },
            ].map((rep) => (
              <button
                key={rep.id}
                onClick={() => setSelectedReport(rep.id as any)}
                className={`p-4 rounded-xl border text-left transition-all flex flex-col justify-between ${
                  selectedReport === rep.id
                    ? 'border-emerald-500 bg-emerald-50/60 ring-2 ring-emerald-500/20'
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <div>
                  <div className="font-bold text-xs text-slate-900">{rep.title}</div>
                  <p className="text-[11px] text-slate-500 mt-1 leading-normal">{rep.desc}</p>
                </div>
                <div className="mt-3 font-mono text-[10px] font-bold text-emerald-700">{rep.count}</div>
              </button>
            ))}
          </div>

          {/* Export Action Card */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
            <div className="font-bold text-xs text-slate-800">Export {selectedReport.toUpperCase()} Data</div>
            {selectedReport === 'faults' && (
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input type="checkbox" checked={includeTests} onChange={(e) => setIncludeTests(e.target.checked)} data-testid="report-include-tests" />
                Include TEST events ({testCount}). They are not real faults and are left out unless ticked.
              </label>
            )}

            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={() => exportPDF(selectedReport)}
                className="py-2.5 px-3 bg-red-600 hover:bg-red-500 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-colors"
              >
                <Download className="w-4 h-4" /> Download PDF Report
              </button>

              <button
                onClick={() => exportCSV(selectedReport)}
                className="py-2.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-colors"
              >
                <Download className="w-4 h-4" /> Export Excel (CSV)
              </button>

              <button
                onClick={exportGeoJSON}
                className="py-2.5 px-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-colors"
              >
                <Download className="w-4 h-4" /> Export GeoJSON Map
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
