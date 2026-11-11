import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, GitCompareArrows, MapPin } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { type CustomerPathFinding, type CustomerPathFix, proposeCustomerPathFixes } from '@fibergis/shared';

import { Button, Modal } from '../../components/ui';
import { requestConfirm } from '../../stores/confirmStore';
import { fixCustomerPaths } from '../../stores/connectionActions';
import { useNetworkStore } from '../../stores/networkStore';

/**
 * Phase 12: customers whose path fields or splitter output disagree with the fibre links, or are
 * blank where the links say. Each shows the fix taken from the links; nothing changes until a person
 * ticks it and confirms. A disagreement the links cannot settle is listed to check on site, with no fix.
 */

const lineFor = (f: CustomerPathFinding) => (f.state === 'missing' ? 'Not recorded' : 'Does not match');

export const CustomerPathCheck: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const { equipment, cables, splitters, closures, customers } = useNetworkStore(
    useShallow((s) => ({ equipment: s.equipment, cables: s.cables, splitters: s.splitters, closures: s.closures, customers: s.customers })),
  );
  const fixes = useMemo<CustomerPathFix[]>(
    () => (open ? proposeCustomerPathFixes({ equipment, cables, splitters, closures, customers }) : []),
    [open, equipment, cables, splitters, closures, customers],
  );
  const fixable = fixes.filter((f) => f.findings.length > 0);
  const onSite = fixes.filter((f) => f.unclear.length > 0);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const fixChosen = async () => {
    const ids = fixable.filter((f) => chosen.has(f.customerId)).map((f) => f.customerId);
    if (ids.length === 0) return;
    const ok = await requestConfirm({
      title: 'Fix from the fibre links?',
      message: `${ids.length} customer(s) will get the values the fibre links show. Each change is written in their history and the audit trail.`,
      confirmLabel: 'Fix them',
      cancelLabel: 'Go back',
    });
    if (!ok) return;
    setSaving(true);
    try {
      const done = await fixCustomerPaths(ids);
      if (done) setChosen(new Set());
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={GitCompareArrows}
      size="xl"
      title="Check customer paths"
      description="The fibre links decide where a customer is connected. Here are the customers whose records say something else, or leave it out."
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="text-[13px] text-slate-600">{chosen.size} chosen</span>
          <div className="flex gap-2">
            <Button className="min-h-12" onClick={onClose}>
              Close
            </Button>
            <Button className="min-h-12" variant="primary" disabled={chosen.size === 0 || saving} loading={saving} onClick={() => void fixChosen()} data-testid="fix-paths">
              Fix chosen from the links
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 text-[13px]" data-testid="path-check">
        {fixable.length === 0 && onSite.length === 0 && (
          <p className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 font-semibold text-emerald-800">
            <CheckCircle2 className="h-5 w-5" /> Every customer agrees with the fibre links.
          </p>
        )}

        {fixable.length > 0 && (
          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold text-slate-800">Can be fixed from the links ({fixable.length})</h3>
              <Button
                className="min-h-12"
                variant="subtle"
                onClick={() => setChosen(chosen.size === fixable.length ? new Set() : new Set(fixable.map((f) => f.customerId)))}
              >
                {chosen.size === fixable.length ? 'Choose none' : 'Choose all'}
              </Button>
            </div>
            <ul className="space-y-2">
              {fixable.map((fix) => (
                <li key={fix.customerId}>
                  <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-6 w-6 shrink-0 accent-blue-600"
                      checked={chosen.has(fix.customerId)}
                      onChange={() => toggle(fix.customerId)}
                      aria-label={`Fix ${fix.customerName}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold text-slate-900">
                        {fix.customerName} <span className="font-mono text-[11px] font-normal text-slate-500">{fix.customerId}</span>
                      </span>
                      {fix.findings.map((f) => (
                        <span key={f.key} className="mt-1 block">
                          <span className={`mr-1 rounded px-1.5 py-0.5 text-[11px] font-bold ${f.state === 'missing' ? 'bg-slate-100 text-slate-700' : 'bg-amber-100 text-amber-900'}`}>{lineFor(f)}</span>
                          {f.message}
                        </span>
                      ))}
                      {fix.gaps.length > 0 && <span className="mt-1 block text-[12px] text-slate-500">The links stop here, so the rest stays as it is: {fix.gaps[0]}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        )}

        {onSite.length > 0 && (
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 font-bold text-slate-800">
              <MapPin className="h-4 w-4" /> Check on site ({onSite.length})
            </h3>
            <p className="mb-2 text-slate-600">Two records disagree and no fibre link says which is right. Look at the box, then record the fibre link.</p>
            <ul className="space-y-2">
              {onSite.flatMap((fix) =>
                fix.unclear.map((f) => (
                  <li key={f.key} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {f.message}
                  </li>
                )),
              )}
            </ul>
          </section>
        )}
      </div>
    </Modal>
  );
};
