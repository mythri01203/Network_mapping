import React, { useMemo, useRef, useState } from 'react';
import { Download, FileSpreadsheet, FileText, History, Image as ImageIcon, Printer, RefreshCw, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { type AuditEvent, buildReports, changeHistoryReport, NO_LIVE_CONNECTION, type ReportFilters, reportFiltersText, type ReportTable, reportToCsv, testRecordKeys } from '@fibergis/shared';

import { authClient, type DataQualitySummary, describeApiError } from '../../api/client';
import { governanceClient } from '../../api/governanceClient';
import { downloadFile } from '../../lib/browser';
import { downloadAllReportsXlsx, downloadReportPdf, downloadReportPng, downloadReportXlsx } from './reportExport';
import { useMayDo } from '../../stores/authStore';
import { selectOpticalSettings, selectOspSettings, useNetworkStore } from '../../stores/networkStore';
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
    // Network mapping Phase 22: where it comes from, for the PDF and Excel.
    sources: ['The server’s map check of the saved network (map check rules and geometry rules)'],
    settingsUsed: ['Your Validation settings (geometry limits)'],
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
${table.sources?.length ? `<p>Made from: ${escapeHtml(table.sources.join(', '))}.</p>` : ''}
${table.settingsUsed?.length ? `<p>Settings used: ${escapeHtml(table.settingsUsed.join('; '))}.</p>` : ''}
${table.noLiveConnection ? `<p class="live">${NO_LIVE_CONNECTION}</p>` : ''}
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
${table.notes.map((n) => `<p>${escapeHtml(n)}</p>`).join('')}
</body></html>`);
  win.document.close();
  win.focus();
  win.print();
  return true;
}

/** Network mapping Phase 22: reports in groups, so the long list stays easy to scan. Unknown ids go last. */
export const REPORT_GROUPS: { title: string; ids: string[] }[] = [
  { title: 'Network records', ids: ['inventory', 'cable-inventory', 'cable-length', 'cores', 'disconnected-cables', 'orphans'] },
  { title: 'Poles, ducts and permissions', ids: ['osp-summary', 'pole-attachments', 'duct-occupancy', 'permissions'] },
  { title: 'Splicing, ODF and customer paths', ids: ['splicing', 'odf-ports', 'customer-paths'] },
  {
    title: 'Capacity and planning',
    ids: ['capacity', 'splitter-capacity', 'capacity-use', 'olt-chassis-capacity', 'capacity-zones', 'capacity-demand', 'planned-vs-built', 'planned-vs-built-capacity', 'capacity-scenarios'],
  },
  { title: 'Customers, faults, jobs and live data', ids: ['customers', 'faults', 'repair-times', 'work-orders', 'live'] },
  { title: 'Checks and history', ids: ['validation-findings', 'data-quality', 'change-history'] },
];

export function groupReports(tables: readonly ReportTable[]): { title: string; tables: ReportTable[] }[] {
  const known = new Set(REPORT_GROUPS.flatMap((g) => g.ids));
  const groups = REPORT_GROUPS.map((g) => ({ title: g.title, tables: g.ids.map((id) => tables.find((t) => t.id === id)).filter((t): t is ReportTable => !!t) }));
  const other = tables.filter((t) => !known.has(t.id));
  return [...groups, ...(other.length ? [{ title: 'Other reports', tables: other }] : [])].filter((g) => g.tables.length > 0);
}

const rowsText = (r: ReportTable) => (r.noLiveConnection ? NO_LIVE_CONNECTION : `${r.rows.length} row(s)`);

/** The report list: a drop-down on phones, cards in groups on wider screens. */
export const ReportPicker: React.FC<{ tables: readonly ReportTable[]; selectedId?: string; onSelect: (id: string) => void }> = ({ tables, selectedId, onSelect }) => {
  const groups = groupReports(tables);
  return (
    <>
      <label className="sm:hidden flex flex-col gap-1 text-xs font-semibold text-slate-700">
        Choose a report
        <select className="h-11 px-3 rounded-lg border border-slate-300 bg-white text-sm" value={selectedId} onChange={(e) => onSelect(e.target.value)} data-testid="report-select">
          {groups.map((g) => (
            <optgroup key={g.title} label={g.title}>
              {g.tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} ({rowsText(t)})
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <div className="hidden sm:block space-y-3">
        {groups.map((g) => (
          <section key={g.title} aria-label={g.title}>
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-600 mb-1.5">{g.title}</h3>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2" role="list">
              {g.tables.map((r) => (
                <button
                  key={r.id}
                  role="listitem"
                  onClick={() => onSelect(r.id)}
                  data-testid={`report-${r.id}`}
                  aria-pressed={selectedId === r.id}
                  className={`min-h-11 p-3 rounded-xl border text-left ${selectedId === r.id ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-500/20' : 'border-slate-200 hover:bg-slate-50'}`}
                >
                  <div className="font-bold text-sm text-slate-900">{r.title}</div>
                  <div className="text-xs text-slate-600 mt-1">{rowsText(r)}</div>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
};

/** How many changes to ask the server for. */
const HISTORY_LIMIT = 2000;

export const ReportsModal: React.FC = () => {
  // Phase 23: saving a report to a file is the export right.
  const mayExport = useMayDo('export');
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
      // Network mapping Phase 18: what the capacity planning reports also read.
      attachments: s.attachments,
      sites: s.sites,
      racks: s.racks,
      zones: s.zones,
      services: s.services,
      planningScenarios: s.planningScenarios,
      // Network mapping Phase 20: what monitoring sources sent, for the live report.
      settings: s.settings,
      monitoringSources: s.monitoringSources,
      onuReadings: s.onuReadings,
      onuStatuses: s.onuStatuses,
      deviceStatuses: s.deviceStatuses,
      rfLevels: s.rfLevels,
      // Network mapping Phase 22: stored map check findings, for their report.
      validationFindings: s.validationFindings,
    })),
  );
  const showToast = useToastStore((s) => s.show);
  const [filters, setFilters] = useState<ReportFilters>({});
  const [selectedId, setSelectedId] = useState('inventory');
  const [quality, setQuality] = useState<{ state: 'idle' | 'loading' | 'error'; summary?: DataQualitySummary; message?: string }>({ state: 'idle' });

  const optical = useNetworkStore(selectOpticalSettings);
  // Network mapping Phase 18: the duct fill levels (Poles and routes settings) for the capacity reports.
  const osp = useNetworkStore(selectOspSettings);
  const reports = useMemo(() => (isOpen ? buildReports(data, filters, undefined, { optical, osp }) : []), [isOpen, data, filters, optical, osp]);
  // Network mapping Phase 22: change history from the server's audit events, loaded on request.
  const [history, setHistory] = useState<{ state: 'idle' | 'loading' | 'error'; events?: AuditEvent[]; loadedAt?: string; message?: string }>({ state: 'idle' });
  const testKeys = useMemo(
    () =>
      testRecordKeys({
        alarms: data.alarms,
        faults: data.faults,
        workOrders: data.workOrders,
        monitoringSources: data.monitoringSources,
        onuReadings: data.onuReadings,
        onuStatuses: data.onuStatuses,
        deviceStatuses: data.deviceStatuses,
      }),
    [data.alarms, data.faults, data.workOrders, data.monitoringSources, data.onuReadings, data.onuStatuses, data.deviceStatuses],
  );
  const historyTable = useMemo(
    () => (history.events ? changeHistoryReport(history.events, { filters, testRecordKeys: testKeys, limit: HISTORY_LIMIT, ...(history.loadedAt ? { loadedAt: history.loadedAt } : {}) }) : undefined),
    [history.events, history.loadedAt, filters, testKeys],
  );
  const all = useMemo(() => [...reports, ...(quality.summary ? [qualityTable(quality.summary)] : []), ...(historyTable ? [historyTable] : [])], [reports, quality.summary, historyTable]);
  const selected = all.find((r) => r.id === selectedId) ?? all[0];
  const testCount = data.faults.filter((f) => f.isTest).length + data.workOrders.filter((w) => w.isTest).length;
  const viewRef = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);

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

  // Network mapping Phase 22: change history, Excel, a generated PDF and a picture.
  const loadHistory = async () => {
    setHistory({ state: 'loading' });
    try {
      const { events } = await governanceClient.auditEvents({ limit: HISTORY_LIMIT });
      setHistory({ state: 'idle', events, loadedAt: new Date().toISOString() });
      setSelectedId('change-history');
    } catch (error) {
      setHistory({ state: 'error', message: describeApiError(error) });
    }
  };

  const run = async (what: string, job: () => Promise<void> | void, done: string) => {
    setBusy(true);
    try {
      await job();
      showToast('success', 'Report saved', done);
    } catch (error) {
      showToast('error', `${what} not saved`, error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const exportXlsx = (table: ReportTable) => run('Excel file', () => downloadReportXlsx(table, filters), `${table.title}: ${table.rows.length} row(s) as an Excel file, with a sheet saying what it is made from.`);
  const exportAllXlsx = () => run('Excel file', () => downloadAllReportsXlsx(all, filters), `${all.length} reports in one Excel file, one sheet each.`);
  const exportPdf = (table: ReportTable) => run('PDF', () => downloadReportPdf(table, filters), `${table.title} as a PDF, with where the figures come from.`);
  const exportPng = (table: ReportTable) =>
    run(
      'Picture',
      async () => {
        if (!viewRef.current) throw new Error('The report is not on screen.');
        await downloadReportPng(viewRef.current, table);
      },
      `${table.title} as a picture (PNG) of what is on screen.`,
    );

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

          <ReportPicker tables={all} selectedId={selected?.id} onSelect={setSelectedId} />

          {/* Network mapping Phase 22: reports the server makes, loaded on request (they need a connection). */}
          {(!quality.summary || !history.events) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
              {!history.events && (
                <button
                  onClick={() => void loadHistory()}
                  disabled={history.state === 'loading'}
                  data-testid="report-change-history-load"
                  className="min-h-11 p-3 rounded-xl border border-dashed border-slate-300 text-left hover:bg-slate-50"
                >
                  <div className="font-bold text-sm text-slate-900 flex items-center gap-2">
                    <History className={`w-4 h-4 ${history.state === 'loading' ? 'animate-pulse' : ''}`} /> Change history
                  </div>
                  <div className="text-xs text-slate-600 mt-1">
                    {history.state === 'loading' ? 'Reading…' : history.state === 'error' ? `Not read: ${history.message}` : 'Who changed what and when, from the server. Needs a connection.'}
                  </div>
                </button>
              )}
            </div>
          )}

          {selected && (
            <section ref={viewRef} className="border border-slate-200 rounded-xl p-3 space-y-2 bg-white" aria-labelledby="report-title" data-testid="report-view">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="report-title" className="font-bold text-base text-slate-900">{selected.title}</h3>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => exportCsv(selected)} hidden={!mayExport} data-testid="report-csv" className="h-11 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold flex items-center gap-2">
                    <Download className="w-4 h-4" /> Save as spreadsheet (CSV)
                  </button>
                  <button
                    onClick={() => void exportXlsx(selected)}
                    hidden={!mayExport}
                    disabled={busy}
                    data-testid="report-xlsx"
                    className="h-11 px-4 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 text-white rounded-xl font-bold flex items-center gap-2"
                  >
                    <FileSpreadsheet className="w-4 h-4" /> Save as Excel
                  </button>
                  <button
                    onClick={() => void exportPdf(selected)}
                    hidden={!mayExport}
                    disabled={busy}
                    data-testid="report-pdf"
                    className="h-11 px-4 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-60 text-slate-800 rounded-xl font-bold flex items-center gap-2"
                  >
                    <FileText className="w-4 h-4" /> Save as PDF
                  </button>
                  <button
                    onClick={() => void exportPng(selected)}
                    hidden={!mayExport || selected.rows.length > 200}
                    disabled={busy}
                    data-testid="report-png"
                    className="h-11 px-4 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-60 text-slate-800 rounded-xl font-bold flex items-center gap-2"
                  >
                    <ImageIcon className="w-4 h-4" /> Save as picture
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
              {!!selected.sources?.length && (
                <p className="text-xs text-slate-600" data-testid="report-sources">
                  <span className="font-semibold text-slate-700">Made from:</span> {selected.sources.join(', ')}.
                </p>
              )}
              {!!selected.settingsUsed?.length && (
                <p className="text-xs text-slate-600" data-testid="report-settings">
                  <span className="font-semibold text-slate-700">Settings used:</span> {selected.settingsUsed.join('; ')}.
                </p>
              )}
              <p className="text-xs text-slate-600">
                <span className="font-semibold text-slate-700">Filters:</span> {reportFiltersText(filters)}.
              </p>
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
              {mayExport && selected.rows.length > 200 && <p className="text-xs text-slate-600">A picture is offered for reports of up to 200 rows; use Excel or PDF for this one.</p>}
              {selected.notes.map((n) => (
                <p key={n} className="text-xs text-amber-800 bg-amber-50 rounded px-2 py-1">{n}</p>
              ))}
            </section>
          )}

          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
            <button onClick={exportGeoJSON} hidden={!mayExport} data-testid="report-geojson" className="h-11 px-4 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl font-bold flex items-center gap-2 text-slate-800">
              <Download className="w-4 h-4" /> Save map file (GeoJSON)
            </button>
            <button
              onClick={() => void exportAllXlsx()}
              hidden={!mayExport}
              disabled={busy}
              data-testid="report-all-xlsx"
              className="h-11 px-4 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-60 rounded-xl font-bold flex items-center gap-2 text-slate-800"
            >
              <FileSpreadsheet className="w-4 h-4" /> Save every report (Excel)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
