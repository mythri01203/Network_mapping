import { type NetworkTraceResult, TRACE_STEP_STATE_LABELS, TRACE_TYPE_LABELS, traceSteps } from './networkTrace';
import { type ReportColumn, reportToCsv } from './reports';

/**
 * Network mapping Phase 15: a trace as a report, for the PDF and the CSV download. Every value is
 * the trace's own; nothing is added. A customer's house position is never written in a report.
 */

export const TRACE_REPORT_COLUMNS: ReportColumn[] = [
  { key: 'part', label: 'Part' },
  { key: 'order', label: 'Step' },
  { key: 'level', label: 'Level' },
  { key: 'kind', label: 'What' },
  { key: 'title', label: 'Name' },
  { key: 'detail', label: 'Detail' },
  { key: 'state', label: 'State' },
  { key: 'why', label: 'Why' },
  { key: 'links', label: 'Links and checks' },
  { key: 'ids', label: 'Record ids' },
  { key: 'position', label: 'Position (as recorded)' },
];

const KIND_WORDS: Record<string, string> = {
  equipment: 'Item',
  port: 'Port',
  odf: 'ODF port',
  cable: 'Cable',
  tube: 'Tube',
  core: 'Fibre',
  splice: 'Splice',
  splitter: 'Splitter',
  ont: 'ONT',
  customer: 'Customer',
  connector: 'Connector',
  service: 'Service',
  route: 'Cable route',
  gap: 'Missing link',
  note: 'Note',
};

export interface TraceReport {
  title: string;
  facts: [string, string][];
  columns: ReportColumn[];
  rows: Record<string, string | number>[];
  footer: string;
}

/** The trace as a table, one row per step, in the order shown on screen. */
export function buildTraceReport(result: NetworkTraceResult, generatedAt: Date): TraceReport {
  const partLabel = (group: number) =>
    group < result.paths.length ? (result.paths[group].label ?? `Path ${group + 1}`) : `Tree ${group - result.paths.length + 1}`;
  const counters = new Map<number, number>();
  const rows = traceSteps(result).map(({ step, depth, group }) => {
    const order = (counters.get(group) ?? 0) + 1;
    counters.set(group, order);
    const hidePosition = step.kind === 'customer' || step.lat === undefined || step.lng === undefined;
    return {
      part: partLabel(group),
      order,
      level: depth,
      kind: KIND_WORDS[step.kind] ?? step.kind,
      title: step.title,
      detail: step.detail,
      state: TRACE_STEP_STATE_LABELS[step.state],
      why: step.reasons.join(' '),
      links: step.links.map((l) => `${l.kindLabel}: ${l.checkLabel} (recorded in ${l.recordedIn})`).join(' | '),
      ids: step.ids.join(', '),
      position: hidePosition ? 'Not shown' : `${step.lat!.toFixed(6)}, ${step.lng!.toFixed(6)}`,
    };
  });
  const c = result.counts;
  return {
    title: result.title,
    facts: [
      ['Trace', TRACE_TYPE_LABELS[result.type]],
      ['From', result.fromLabel],
      ...(result.toLabel ? [['To', result.toLabel] as [string, string]] : []),
      ['Level', result.level === 'cable' ? 'Cables only: fibres not recorded end to end' : result.level === 'fibre' ? 'Fibre by fibre, from recorded links' : result.level === 'logical' ? 'Service path, from recorded links' : 'Who is affected, from recorded paths'],
      ['Result', result.complete ? 'No missing link' : `${result.gaps.length} missing link(s)`],
      ['Steps', `${c.steps}: ${c.ok} checked good, ${c.unverified} not checked, ${c.warning} to check, ${c.planned} planned, ${c.faulty} faulty, ${c.missing} missing`],
      ...result.gaps.slice(0, 10).map((g, i) => [`Missing ${i + 1}`, g] as [string, string]),
      ...result.warnings.slice(0, 10).map((w, i) => [`Warning ${i + 1}`, w] as [string, string]),
      ...result.notes.slice(0, 6).map((n, i) => [`Note ${i + 1}`, n] as [string, string]),
    ],
    columns: TRACE_REPORT_COLUMNS,
    rows,
    footer: `Made from FiberGIS records on ${generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC. Only recorded links are followed; a missing link is never filled in. "Not checked" means nobody has recorded a check of that link.`,
  };
}

/** CSV through the shared safe writer (quotes escaped, formula cells kept as text). */
export function traceReportCsv(report: Pick<TraceReport, 'columns' | 'rows'>): string {
  return reportToCsv({ columns: report.columns, rows: report.rows });
}
