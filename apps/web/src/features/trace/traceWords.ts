import type { TraceStep, TraceStepState } from '@fibergis/shared';

/** Network mapping Phase 15: a mark and words for each trace step state and kind, never colour alone. */

export const STATE_STYLE: Record<TraceStepState, { mark: string; stroke: string; fill: string; dash?: string; badge: string }> = {
  ok: { mark: '✓', stroke: '#059669', fill: '#ecfdf5', badge: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
  unverified: { mark: '○', stroke: '#64748b', fill: '#ffffff', dash: '4 3', badge: 'border-slate-300 bg-white text-slate-700' },
  warning: { mark: '!', stroke: '#d97706', fill: '#fffbeb', badge: 'border-amber-300 bg-amber-50 text-amber-900' },
  planned: { mark: '◷', stroke: '#7c3aed', fill: '#f5f3ff', dash: '6 3', badge: 'border-violet-300 bg-violet-50 text-violet-900' },
  faulty: { mark: '✕', stroke: '#dc2626', fill: '#fef2f2', badge: 'border-red-300 bg-red-50 text-red-900' },
  missing: { mark: '⚠', stroke: '#b91c1c', fill: '#ffffff', dash: '3 3', badge: 'border-red-400 bg-white text-red-800 border-dashed' },
};

export const KIND_WORDS: Record<TraceStep['kind'], string> = {
  equipment: 'Item',
  port: 'Port',
  odf: 'ODF',
  cable: 'Cable',
  tube: 'Tube',
  core: 'Fibre',
  splice: 'Splice',
  splitter: 'Splitter',
  ont: 'ONT',
  customer: 'Customer',
  connector: 'Connector',
  service: 'Service',
  route: 'Route',
  gap: 'Missing',
  note: 'Note',
};
