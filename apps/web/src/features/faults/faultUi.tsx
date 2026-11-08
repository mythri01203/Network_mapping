import React from 'react';

import {
  type Confidence,
  NETWORK_ELEMENT_LABELS,
  type NetworkElementRef,
  type NetworkElementType,
  photoUrl,
} from '@fibergis/shared';

import { useNetworkStore } from '../../stores/networkStore';
import { PhotoView } from '../capture/ui';

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

/** A job or fault photo: the phone's own copy first, then the office copy. */
export function JobPhoto({ photoId, className }: { photoId: string; className?: string }) {
  return <PhotoView photoId={photoId} url={`${API_BASE}${photoUrl(photoId)}`} className={className} alt="" />;
}

/** Shown on every TEST alarm, fault and job, never colour alone. */
export function TestBadge({ isTest }: { isTest?: boolean }) {
  if (!isTest) return null;
  return (
    <span className="rounded border border-violet-700 bg-violet-100 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-violet-900" data-testid="test-badge">
      TEST · not real
    </span>
  );
}

const CONFIDENCE_STYLE: Record<Confidence, string> = {
  high: 'bg-rose-100 text-rose-900 border-rose-300',
  medium: 'bg-amber-100 text-amber-900 border-amber-300',
  low: 'bg-slate-100 text-slate-700 border-slate-300',
};

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${CONFIDENCE_STYLE[confidence]}`} data-testid="confidence">
      Suspected · {confidence} confidence
    </span>
  );
}

/** Said everywhere alarms are shown: there is no device connection, so nothing here is live. */
export function NoLiveConnection() {
  return (
    <div className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-[11px] text-slate-700" data-testid="no-live-connection">
      <strong>No live connection</strong> to the OLT. Alarms here are reported by people, from the field, or are TEST events. None comes from a device,
      so a customer with no alarm is not proven to be working.
    </div>
  );
}

export const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-blue-500';
export const buttonClass = 'rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40';

const PICKABLE: NetworkElementType[] = ['customer', 'splitter', 'closure', 'cable', 'core', 'pon_port', 'olt', 'equipment', 'span', 'ont'];

/** Choose one network element: a type, then the record, then the port or fiber where needed. */
export function ElementPicker({ value, onChange, types = PICKABLE, testId }: { value: NetworkElementRef | null; onChange: (el: NetworkElementRef | null) => void; types?: NetworkElementType[]; testId?: string }) {
  const { equipment, cables, splitters, closures, customers, spans, onts } = useNetworkStore();
  const type = value?.type ?? types[0];
  const options: { id: string; label: string }[] = (() => {
    switch (type) {
      case 'customer':
        return customers.filter((c) => c.status !== 'Disconnected').map((c) => ({ id: c.id, label: `${c.name} (${c.id})` }));
      case 'splitter':
        return splitters.map((s) => ({ id: s.id, label: `${s.name} (${s.id})` }));
      case 'closure':
        return closures.map((c) => ({ id: c.id, label: `${c.name} (${c.id})` }));
      case 'cable':
      case 'core':
        return cables.map((c) => ({ id: c.id, label: `${c.name} (${c.id}, ${c.fiberCount}F)` }));
      case 'pon_port':
      case 'olt':
        return equipment.filter((e) => e.type === 'OLT').map((e) => ({ id: e.id, label: `${e.name} (${e.id})` }));
      case 'equipment':
        return equipment.filter((e) => e.type !== 'OLT').map((e) => ({ id: e.id, label: `${e.name} (${e.type}, ${e.id})` }));
      case 'span':
        return spans.map((s) => ({ id: s.id, label: `${s.name} (${s.id})` }));
      case 'ont':
        return onts.filter((o) => o.status !== 'removed').map((o) => ({ id: o.id, label: `ONT ${o.serialNumber || o.id}` }));
    }
  })();
  const olt = type === 'pon_port' && value ? equipment.find((e) => e.id === value.id) : undefined;
  const cable = type === 'core' && value ? cables.find((c) => c.id === value.id) : undefined;
  return (
    <div className="grid gap-2 sm:grid-cols-3" data-testid={testId}>
      <select
        className={inputClass}
        value={type}
        aria-label="What is it"
        onChange={(e) => onChange({ type: e.target.value as NetworkElementType, id: '' })}
      >
        {types.map((t) => (
          <option key={t} value={t}>
            {NETWORK_ELEMENT_LABELS[t]}
          </option>
        ))}
      </select>
      <select className={inputClass} value={value?.id ?? ''} aria-label="Which one" onChange={(e) => onChange(e.target.value ? { type, id: e.target.value } : { type, id: '' })}>
        <option value="">Choose…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      {type === 'pon_port' && (
        <select className={inputClass} value={value?.ponPortId ?? ''} aria-label="PON port" onChange={(e) => value && onChange({ ...value, ponPortId: e.target.value || undefined })}>
          <option value="">Port…</option>
          {(olt?.ponPorts ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.id}
              {p.vendorAddress ? ` (${p.vendorAddress})` : ''}
            </option>
          ))}
        </select>
      )}
      {type === 'core' && (
        <input
          className={inputClass}
          type="number"
          min={1}
          max={cable?.fiberCount ?? 288}
          placeholder="Fiber number"
          aria-label="Fiber number"
          value={value?.fiberNumber ?? ''}
          onChange={(e) => value && onChange({ ...value, fiberNumber: Number(e.target.value) || undefined })}
        />
      )}
    </div>
  );
}

export function Section({ title, children, testId, right }: { title: string; children: React.ReactNode; testId?: string; right?: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-3" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-bold text-slate-800">{title}</h4>
        {right}
      </div>
      {children}
    </section>
  );
}

