import React, { useMemo, useState } from 'react';
import { Download, FileSpreadsheet, Printer, RefreshCw, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { buildReports, NO_LIVE_CONNECTION, type ReportFilters, type ReportTable, reportToCsv } from '@fibergis/shared';

import { authClient, type DataQualitySummary, describeApiError } from '../../api/client';
import { downloadFile } from '../../lib/browser';
import { useNetworkStore } from '../../stores/networkStore';
import { useToastStore } from '../../stores/toastStore';
import { useUiStore } from '../../stores/uiStore';

/**
 * Reports (Phase 9, section 22). Every figure comes from the saved records through the shared
 * `buildReports`; each table says how it is worked out and what is missing. TEST events are left
 * out unless ticked. Live monitoring needs Phase 7 and says "No live connection".
 */

const escapeHtml = (value: unknown) =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const fileSafe = (text: string) => text.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

/** A data-quality summary as a report table, so it prints and exports like the others. */
function qualityTable(summary: DataQualitySummary): ReportTable {
  return {
    id: 'data-quality',
    title: 'Data quality (map check)',
    definition:
      'The same rules as the map check, run by the server on the saved network. Errors are wrong links or impossible values; warnings need a look; notes are missing facts. Only record ids are shown.',
    columns: [
      { key: 'level', label: 'Level' },
      { key: 'rule', label: 'Rule' },
      { key: 'count', label: 'Problems' },
      { key: 'examples', label: 'Example ids' },
    ],
    rows: summary.rules.map((r) => ({ level: r.severity, rule: r.rule, count: r.count, examples: r.exampleIds.join(' ') })),
    notes: [`Checked ${summary.checkedAt.slice(0, 16).replace('T', ' ')} UTC, network revision ${summary.revision}.`, ...(summary.rules.length === 0 ? ['No problems found.'] : [])],
  };
}

function printReport(table: ReportTable, filters: ReportFilters) {
  const win = window.open('', '_blank');
  if (!win) return false;
  const filterText = [
    filters.from ? `from ${filters.from}` : '',
    filters.to ? `to ${filters.to}` : '',
    filters.area ? `area "${filters.area}"` : '',
    filters.includeTest ? 'TEST events included' : 'TEST events left out',
  ]
    .filter(Boolean)
    .join(', ');
  const head = table.columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('');
  const body = table.rows.length
    ? table.rows.map((r) => `<tr>${table.columns.map((c) => `<td>${escapeHtml(r[c.key] ?? '')}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${table.columns.length}">Nothing recorded.</td></tr>`;
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(table.title)}</title>
<style>body{font:13px system-ui,sans-serif;margin:24px;color:#0f172a}h1{font-size:18px}p{margin:4px 0;color:#334155}
table{border-collapse:collapse;width:100%;margin-top:12px}th,td{border:1px solid #cbd5e1;padding:4px 6px;text-align:left}th{background:#f1f5f9}
.live{font-weight:700;color:#b91c1c}</style></head><body>
<h1>${escapeHtml(table.title)}</h1>
<p>Printed ${escapeHtml(new Date().toLocaleString())}. ${escapeHtml(filterText)}.</p>
<p>${escapeHtml(table.definition)}</p>
${table.noLiveConnection ? `<p class="live">${NO_LIVE_CONNECTION}</p>` : ''}
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
${table.notes.map((n) => `<p>${escapeHtml(n)}</p>`).join('')}
</body></html>`);
  win.document.close();
  win.focus();
  win.print();
  return true;
}

export const ReportsModal: React.FC = () => {
  const { isOpen, setModalOpen } = useUiStore(useShallow((s) => ({ isOpen: s.modals.reports, setModalOpen: s.setModalOpen })));
  const data = useNetworkStore(
    useShallow((s) => ({
      equipment: s.equipment,
      cables: s.cables,
      splitters: s.splitters,
      closures: s.closures,
      customers: s.customers,
      faults: s.faults,
      workOrders: s.workOrders,
      spans: s.spans,
      ducts: s.ducts,
      slackLoops: s.slackLoops,
      onts: s.onts,
      alarms: s.alarms,
      permissions: s.permissions,
    })),
  );
  const showToast = useToastStore((s) => s.show);
  const [filters, setFilters] = useState<ReportFilters>({});
  const [selectedId, setSelectedId] = useState('inventory');
  const [quality, setQuality] = useState<{ state: 'idle' | 'loading' | 'error'; summary?: DataQualitySummary; message?: string }>({ state: 'idle' });

  const reports = useMemo(() => (isOpen ? buildReports(data, filters) : []), [isOpen, data, filters]);
  const all = useMemo(() => (quality.summary ? [...reports, qualityTable(quality.summary)] : reports), [reports, quality.summary]);
  const selected = all.find((r) => r.id === selectedId) ?? all[0];
  const testCount = data.faults.filter((f) => f.isTest).length + data.workOrders.filter((w) => w.isTest).length;

  if (!isOpen) return null;

  const loadQuality = async () => {
    setQuality({ state: 'loading' });
    try {
      const summary = await authClient.dataQuality();
      setQuality({ state: 'idle', summary });
      setSelectedId('data-quality');
    } catch (error) {
      setQuality({ state: 'error', message: describeApiError(error) });
    }
  };

  const exportCsv = (table: ReportTable) => {
    downloadFile(reportToCsv(table), 'text/csv;charset=utf-8', `fibergis-${fileSafe(table.id)}-${new Date().toISOString().slice(0, 10)}.csv`);
    showToast('success', 'Report saved', `${table.title}: ${table.rows.length} row(s) as a spreadsheet file (CSV).`);
  };

  const exportGeoJSON = () => {
    const geojson = {
      type: 'FeatureCollection',
      features: [
        ...data.equipment.map((e) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [e.lng, e.lat] },
          properties: { id: e.id, name: e.name, type: e.type, category: e.category, status: e.status, area: e.area },
        })),
        ...data.cables.map((c) => ({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: c.coordinates.map((pt) => [pt[1], pt[0]]) },
          properties: { id: c.id, name: c.name, type: c.type, fiberCount: c.fiberCount, lengthMeters: c.lengthMeters },
        })),
      ],
    };
    downloadFile(JSON.stringify(geojson), 'application/geo+json', `fibergis-network-${new Date().toISOString().slice(0, 10)}.geojson`);
    showToast('success', 'Map file saved', 'Network items and cables as a GeoJSON map file. No customer details are in it.');
  };

  const input = 'h-11 px-3 rounded-lg border border-slate-300 bg-white text-sm';
  return (
    <div className="modal-sheet fixed inset-0 z-[1000] bg-slate-900/60 flex items-stretch sm:items-center justify-center sm:p-4" data-testid="reports-modal">
      <div className="bg-white sm:rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl overflow-hidden flex flex-col sm:max-h-[90vh]">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-emerald-600 text-white flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-base text-slate-900">Reports</h2>
              <p className="text-xs text-slate-600">Counted from the saved records only. Each report says how.</p>
            </div>
          </div>
          <button onClick={() => setModalOpen('reports', false)} aria-label="Close reports" className="w-11 h-11 flex items-center justify-center text-slate-500 hover:bg-slate-200 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
          <fieldset className="flex flex-wrap items-end gap-3" aria-label="Report filters">
            <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
              From
              <input type="date" className={input} value={filters.from ?? ''} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value || undefined }))} data-testid="report-from" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
              To
              <input type="date" className={input} value={filters.to ?? ''} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value || undefined }))} data-testid="report-to" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
              Area
              <input type="text" className={input} placeholder="Every area" value={filters.area ?? ''} onChange={(e) => setFilters((f) => ({ ...f, area: e.target.value || undefined }))} data-testid="report-area" />
            </label>
            <label className="flex items-center gap-2 h-11 text-sm text-slate-700">
              <input type="checkbox" className="w-5 h-5" checked={!!filters.includeTest} onChange={(e) => setFilters((f) => ({ ...f, includeTest: e.target.checked }))} data-testid="report-include-tests" />
              Include TEST events ({testCount})
            </label>
          </fieldset>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="list">
            {all.map((r) => (
              <button
                key={r.id}
                role="listitem"
                onClick={() => setSelectedId(r.id)}
                data-testid={`report-${r.id}`}
                aria-pressed={selected?.id === r.id}
                className={`min-h-11 p-3 rounded-xl border text-left ${selected?.id === r.id ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-500/20' : 'border-slate-200 hover:bg-slate-50'}`}
              >
                <div className="font-bold text-sm text-slate-900">{r.title}</div>
                <div className="text-xs text-slate-600 mt-1">{r.noLiveConnection ? NO_LIVE_CONNECTION : `${r.rows.length} row(s)`}</div>
              </button>
            ))}
            {!quality.summary && (
              <button
                onClick={() => void loadQuality()}
                disabled={quality.state === 'loading'}
                data-testid="report-data-quality-load"
                className="min-h-11 p-3 rounded-xl border border-dashed border-slate-300 text-left hover:bg-slate-50"
              >
                <div className="font-bold text-sm text-slate-900 flex items-center gap-2">
                  <RefreshCw className={`w-4 h-4 ${quality.state === 'loading' ? 'animate-spin' : ''}`} /> Data quality (map check)
                </div>
                <div className="text-xs text-slate-600 mt-1">
                  {quality.state === 'loading' ? 'Checking…' : quality.state === 'error' ? `Not checked: ${quality.message}` : 'Ask the server to check the map. Needs a connection.'}
                </div>
              </button>
            )}
          </div>

          {selected && (
            <section className="border border-slate-200 rounded-xl p-3 space-y-2" aria-labelledby="report-title" data-testid="report-view">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="report-title" className="font-bold text-base text-slate-900">{selected.title}</h3>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => exportCsv(selected)} data-testid="report-csv" className="h-11 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold flex items-center gap-2">
                    <Download className="w-4 h-4" /> Save as spreadsheet (CSV)
                  </button>
                  <button
                    onClick={() => {
                      if (!printReport(selected, filters)) showToast('warning', 'Print window blocked', 'Allow pop-ups for this site, then try again.');
                    }}
                    data-testid="report-print"
                    className="h-11 px-4 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold flex items-center gap-2"
                  >
                    <Printer className="w-4 h-4" /> Print or save as PDF
                  </button>
                </div>
              </div>
              {selected.noLiveConnection && (
                <p className="font-bold text-red-700" data-testid="report-no-live">
                  {NO_LIVE_CONNECTION}
                </p>
              )}
              <p className="text-xs text-slate-600">{selected.definition}</p>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs border-collapse">
                  <thead>
                    <tr>
                      {selected.columns.map((c) => (
                        <th key={c.key} className="border border-slate-200 bg-slate-50 px-2 py-1.5 text-left font-bold text-slate-700">{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {selected.rows.slice(0, 500).map((row, i) => (
                      <tr key={i}>
                        {selected.columns.map((c) => (
                          <td key={c.key} className="border border-slate-200 px-2 py-1.5 text-slate-800">{row[c.key] ?? ''}</td>
                        ))}
                      </tr>
                    ))}
                    {selected.rows.length === 0 && (
                      <tr>
                        <td colSpan={selected.columns.length} className="border border-slate-200 px-2 py-3 text-slate-600">Nothing recorded.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {selected.rows.length > 500 && <p className="text-xs text-slate-600">Showing the first 500 of {selected.rows.length} rows. The spreadsheet file has them all.</p>}
              {selected.notes.map((n) => (
                <p key={n} className="text-xs text-amber-800 bg-amber-50 rounded px-2 py-1">{n}</p>
              ))}
            </section>
          )}

          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
            <button onClick={exportGeoJSON} className="h-11 px-4 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl font-bold flex items-center gap-2 text-slate-800">
              <Download className="w-4 h-4" /> Save map file (GeoJSON)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
