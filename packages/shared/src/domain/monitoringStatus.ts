import { type MonitoringSource, ONU_STATE_LABELS, type OnuReading, type OnuState, type OnuStatus, type ReadingDirection } from '../model/monitoringSchemas';
import type { Customer } from '../model/types';
import { DEFAULT_MONITORING_SETTINGS, type MonitoringSettings } from './monitoringSettings';
import { DEFAULT_OPTICAL_SETTINGS, type OpticalSettings, RX_BAND_LABELS, type RxBand, rxBandFor } from './opticalSettings';
import { NO_LIVE_CONNECTION } from './reports';

/**
 * How to show one monitored value (Phase 7): its age, its source, and whether it is live, stale or
 * TEST. "Live" only for a real (not TEST) source inside the freshness window; a stale value says
 * stale with its age, never current. With no row at all: "No live connection".
 */


export interface MonitoringData {
  monitoringSources?: readonly MonitoringSource[];
  onuReadings?: readonly OnuReading[];
  onuStatuses?: readonly OnuStatus[];
}

/** "just now", "12 min ago", "3 h ago", "2 days ago". */
export function ageText(fromIso: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(fromIso)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 120) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} days ago`;
}

const newest = <T extends { deviceTime: string; receivedAt: string }>(rows: readonly T[]): T | undefined =>
  rows.reduce<T | undefined>((best, r) => (!best || r.deviceTime > best.deviceTime || (r.deviceTime === best.deviceTime && r.receivedAt > best.receivedAt) ? r : best), undefined);

/** The newest status of an ONT. TEST rows only when asked for, and never mixed with real ones. */
export function latestStatus(data: MonitoringData, ontId: string, test = false): OnuStatus | undefined {
  return newest((data.onuStatuses ?? []).filter((s) => s.ontId === ontId && s.isTest === test));
}

export function latestReading(data: MonitoringData, ontId: string, direction: ReadingDirection, test = false): OnuReading | undefined {
  return newest((data.onuReadings ?? []).filter((r) => r.ontId === ontId && r.direction === direction && r.isTest === test));
}

export const sourceName = (data: MonitoringData, id: string): string => data.monitoringSources?.find((s) => s.id === id)?.name ?? `${id} (source not on record)`;

export interface ShownValue {
  /** Live, stale, TEST, or none. */
  freshness: 'live' | 'stale' | 'test' | 'none';
  stale: boolean;
  ageText?: string;
  at?: string;
  source?: string;
  /** Ready to show: "Live · 2 min ago · NMS push" or "Stale · 3 h ago · NMS push" or "No live connection". */
  note: string;
}

function shown(row: { deviceTime: string; sourceId: string; isTest: boolean } | undefined, data: MonitoringData, limitMinutes: number, now: Date): ShownValue {
  if (!row) return { freshness: 'none', stale: false, note: NO_LIVE_CONNECTION };
  const age = ageText(row.deviceTime, now);
  const stale = now.getTime() - Date.parse(row.deviceTime) > limitMinutes * 60_000;
  const source = sourceName(data, row.sourceId);
  const freshness = row.isTest ? 'test' : stale ? 'stale' : 'live';
  const word = row.isTest ? `TEST · not real${stale ? ' · stale' : ''}` : stale ? 'Stale' : 'Live';
  return { freshness, stale, ageText: age, at: row.deviceTime, source, note: `${word} · ${age} · ${source}` };
}

export interface ShownStatus extends ShownValue {
  state?: OnuState;
  /** "Online", "Offline (stale)", "No live connection". Never "Online" for a stale or TEST row alone. */
  label: string;
  record?: OnuStatus;
}

export function showStatus(row: OnuStatus | undefined, data: MonitoringData, settings: MonitoringSettings = DEFAULT_MONITORING_SETTINGS, now = new Date()): ShownStatus {
  const v = shown(row, data, settings.statusStaleMinutes, now);
  if (!row) return { ...v, label: NO_LIVE_CONNECTION };
  const label = `${row.isTest ? 'TEST: ' : ''}${ONU_STATE_LABELS[row.state]}${v.stale ? ' (stale, last known)' : ''}`;
  return { ...v, state: row.state, label, record: row };
}

export interface ShownReading extends ShownValue {
  valueDbm?: number;
  band: RxBand;
  bandLabel: string;
  text: string;
  record?: OnuReading;
}

export function showReading(row: OnuReading | undefined, data: MonitoringData, optical: OpticalSettings = DEFAULT_OPTICAL_SETTINGS, settings: MonitoringSettings = DEFAULT_MONITORING_SETTINGS, now = new Date()): ShownReading {
  const v = shown(row, data, settings.readingStaleMinutes, now);
  if (!row) return { ...v, band: 'unknown', bandLabel: RX_BAND_LABELS.unknown, text: NO_LIVE_CONNECTION };
  // Bands from Optical settings apply to the ONT receive level only; the OLT side has none recorded.
  const band = row.direction === 'ont_rx' ? rxBandFor(row.valueDbm, optical) : 'unknown';
  const bandLabel = row.direction === 'ont_rx' ? RX_BAND_LABELS[band] : 'No band set for the OLT receive level';
  const text = `${row.valueDbm.toFixed(1)} dBm (${row.isTest ? 'TEST · not real' : v.stale ? 'Measured, stale' : 'Measured'})`;
  return { ...v, valueDbm: row.valueDbm, band, bandLabel, text, record: row };
}

/**
 * A copy of the customer carrying the newest real ONT receive reading as `device_reported`, so the
 * Phase 5 reconciliation compares it with the prediction. TEST readings are never used.
 */
export function withDeviceRx(customer: Customer, data: MonitoringData): Customer {
  const reading = customer.ontId ? latestReading(data, customer.ontId, 'ont_rx') : undefined;
  if (!reading) return customer;
  const own = customer.rxMeasuredAt && customer.rxSource === 'field_measured' && customer.rxMeasuredAt > reading.deviceTime;
  if (own) return customer;
  return { ...customer, rxOpticalPowerDbm: reading.valueDbm, rxSource: 'device_reported', rxMeasuredAt: reading.deviceTime };
}

/** Whether a real source sent anything inside the status window: the only time "Live" may show. */
export function liveSources(data: MonitoringData, settings: MonitoringSettings = DEFAULT_MONITORING_SETTINGS, now = new Date()): { live: boolean; real: MonitoringSource[]; liveIds: string[]; lastReceivedAt?: string } {
  const real = (data.monitoringSources ?? []).filter((s) => !s.isTest);
  const limit = now.getTime() - settings.statusStaleMinutes * 60_000;
  const rows = [...(data.onuStatuses ?? []), ...(data.onuReadings ?? [])].filter((r) => !r.isTest && real.some((s) => s.id === r.sourceId));
  const liveIds = [...new Set(rows.filter((r) => Date.parse(r.receivedAt) >= limit && Date.parse(r.deviceTime) >= limit).map((r) => r.sourceId))];
  const lastReceivedAt = rows.reduce<string | undefined>((m, r) => (!m || r.receivedAt > m ? r.receivedAt : m), undefined);
  return { live: liveIds.length > 0, real, liveIds, ...(lastReceivedAt ? { lastReceivedAt } : {}) };
}
