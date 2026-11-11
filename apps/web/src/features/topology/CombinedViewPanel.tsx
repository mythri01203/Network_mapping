import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import {
  type CombinedRow,
  type CombinedStep,
  type CombinedTarget,
  combinedTargets,
  type CombinedView,
  combinedView,
  type Equipment,
  findLogicalProblems,
  LOGICAL_SETTING_DEFS,
  type Ont,
  type PonAgreement,
  resolveLogicalSettings,
  type Service,
  type ServiceBindingDraft,
} from '@fibergis/shared';

import { cn } from '../../components/ui';
import { currentAccount, useMayDo } from '../../stores/authStore';
import { saveBinding, saveOntRegistration, setLogicalSetting } from '../../stores/logicalActions';
import { useNetworkStore } from '../../stores/networkStore';

/**
 * Network mapping Phase 14: for an OLT, PON port, splitter or customer, the physical path from the
 * fibre links next to the service settings a person recorded (the logical binding), with every
 * place they disagree named and marked (✕ and words, never colour alone). Nothing is filled in:
 * what nobody recorded says "Not recorded". On a phone the two sides stack.
 */

const AGREEMENT: Record<PonAgreement, { mark: string; text: string; tone: string }> = {
  agrees: { mark: '✓', text: 'PON port matches the fibre links', tone: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
  disagrees: { mark: '✕', text: 'PON port does not match the fibre links', tone: 'border-amber-400 bg-amber-50 text-amber-900' },
  not_decided: { mark: '?', text: 'Not decided: the fibre links stop before a PON port', tone: 'border-slate-300 bg-slate-50 text-slate-800' },
  not_recorded: { mark: '–', text: 'Registration on the OLT not recorded', tone: 'border-slate-300 bg-slate-50 text-slate-800' },
};

const big = 'min-h-12 rounded-lg px-3 text-sm font-semibold md:min-h-9 md:text-xs';

function StepList({ steps, testid }: { steps: CombinedStep[]; testid: string }) {
  return (
    <dl className="space-y-1" data-testid={testid}>
      {steps.map((s) => (
        <div key={s.label} className={cn('rounded px-2 py-1 text-[13px]', s.status === 'mismatch' && 'bg-amber-100 text-amber-950')} data-status={s.status}>
          <dt className="text-xs text-slate-600">{s.label}</dt>
          <dd className={cn('break-words', s.status === 'missing' ? 'text-slate-500' : 'font-medium text-slate-900')}>
            {s.status === 'mismatch' && <span aria-label="Does not match">✕ </span>}
            {s.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const num = (text: string): number | undefined | 'bad' => {
  const t = text.trim();
  if (!t) return undefined;
  return /^\d{1,4}$/.test(t) && Number(t) >= 1 && Number(t) <= 4094 ? Number(t) : 'bad';
};

function BindingForm({ service, onDone }: { service: Service; onDone: () => void }) {
  const [draft, setDraft] = useState({
    vlan: service.vlan?.toString() ?? '',
    sVlan: service.sVlan?.toString() ?? '',
    cVlan: service.cVlan?.toString() ?? '',
    profileName: service.profileName ?? '',
    ipAddress: service.ipAddress ?? '',
    circuitId: service.circuitId ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const field = (key: keyof typeof draft, label: string, numeric = false) => (
    <label className="block text-xs text-slate-700">
      {label}
      <input
        value={draft[key]}
        inputMode={numeric ? 'numeric' : 'text'}
        onChange={(e) => setDraft({ ...draft, [key]: numeric ? e.target.value.replace(/\D/g, '') : e.target.value })}
        data-testid={`binding-${key}`}
        className="mt-0.5 block min-h-12 w-full rounded-lg border border-slate-300 px-2 text-sm md:min-h-9"
      />
    </label>
  );
  const save = async () => {
    const tags = { vlan: num(draft.vlan), sVlan: num(draft.sVlan), cVlan: num(draft.cVlan) };
    if (Object.values(tags).includes('bad')) {
      setError('A VLAN is a whole number from 1 to 4094. Leave it empty when it is not known.');
      return;
    }
    setError(null);
    const out: ServiceBindingDraft = { ...(tags as { vlan?: number; sVlan?: number; cVlan?: number }), profileName: draft.profileName, ipAddress: draft.ipAddress, circuitId: draft.circuitId };
    if (await saveBinding(service.id, out)) onDone();
  };
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-violet-200 bg-violet-50/50 p-2" data-testid={`binding-form-${service.id}`}>
      <p className="text-xs text-slate-700">Type what the OLT or the office shows. Leave a box empty when it is not known; it will say "Not recorded".</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {field('vlan', 'VLAN (one tag)', true)}
        {field('sVlan', 'S-VLAN (outer tag)', true)}
        {field('cVlan', 'C-VLAN (inner tag)', true)}
      </div>
      {field('profileName', 'Profile name on the OLT')}
      {field('ipAddress', 'IP address, or PPPoE or DHCP')}
      {field('circuitId', 'Circuit id')}
      {error && <p className="text-xs font-semibold text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={cn(big, 'bg-blue-600 text-white')} onClick={() => void save()} data-testid="binding-save">
          Save service settings
        </button>
        <button type="button" className={cn(big, 'border border-slate-300 bg-white text-slate-800')} onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function RegistrationForm({ ont, olts, onDone }: { ont: Ont; olts: readonly Equipment[]; onDone: () => void }) {
  const [oltId, setOltId] = useState(ont.oltId ?? '');
  const [ponPortId, setPonPortId] = useState(ont.ponPortId ?? '');
  const ports = olts.find((o) => o.id === oltId)?.ponPorts ?? [];
  const save = async () => {
    const done = await saveOntRegistration(ont.id, oltId && ponPortId ? { oltId, ponPortId } : null);
    if (done) onDone();
  };
  const select = 'mt-0.5 block min-h-12 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm md:min-h-9';
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-violet-200 bg-violet-50/50 p-2" data-testid={`registration-form-${ont.id}`}>
      <p className="text-xs text-slate-700">Choose the port the OLT shows this ONT on. Choose "Not recorded" when nobody has checked.</p>
      <label className="block text-xs text-slate-700">
        OLT
        <select
          className={select}
          value={oltId}
          onChange={(e) => {
            setOltId(e.target.value);
            setPonPortId('');
          }}
        >
          <option value="">Not recorded</option>
          {olts.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-slate-700">
        PON port
        <select className={select} value={ponPortId} disabled={!oltId} onChange={(e) => setPonPortId(e.target.value)}>
          <option value="">Not recorded</option>
          {ports.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id}
              {p.vendorAddress ? ` (${p.vendorAddress})` : ''}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={cn(big, 'bg-blue-600 text-white')} disabled={!!oltId && !ponPortId} onClick={() => void save()}>
          Save registration
        </button>
        <button type="button" className={cn(big, 'border border-slate-300 bg-white text-slate-800')} onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function RowCard({ row, canEdit, olts }: { row: CombinedRow; canEdit: boolean; olts: readonly Equipment[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const a = AGREEMENT[row.pon];
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-3" data-testid={`combined-row-${row.key}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-bold text-slate-900">{row.customerLabel}</h4>
        <span className={cn('rounded-full border px-2 py-0.5 text-xs font-semibold', a.tone)} data-testid="combined-agreement">
          <span aria-hidden="true">{a.mark} </span>
          {a.text}
        </span>
      </div>
      <p className="text-xs text-slate-500">{row.customer.id}</p>
      {row.disagreements.length > 0 && (
        <ul className="mt-2 space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-2 text-[13px] text-amber-950" data-testid="combined-disagreements">
          {row.disagreements.map((d) => (
            <li key={d}>✕ {d}</li>
          ))}
        </ul>
      )}
      <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
        <section>
          <h5 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-600">From the fibre links</h5>
          <StepList steps={row.physical} testid="combined-physical" />
          {row.physicalGaps.length > 0 && (
            <ul className="mt-1 space-y-1 text-xs text-red-800">
              {row.physicalGaps.map((g) => (
                <li key={g}>✕ Missing link: {g}</li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h5 className="mb-1 text-xs font-bold uppercase tracking-wide text-violet-800">Service settings as recorded</h5>
          <StepList steps={row.logical} testid="combined-logical" />
          {canEdit && row.ont && row.ont.status !== 'removed' && editing !== 'registration' && (
            <button type="button" className={cn(big, 'mt-1 border border-slate-300 bg-white text-slate-800')} onClick={() => setEditing('registration')}>
              Change registration
            </button>
          )}
          {editing === 'registration' && row.ont && <RegistrationForm ont={row.ont} olts={olts} onDone={() => setEditing(null)} />}
          {row.services.length === 0 ? (
            <p className="mt-2 text-[13px] text-slate-600">No service recorded.</p>
          ) : (
            row.services.map((s) => (
              <div key={s.service.id} className="mt-2 rounded-lg border border-violet-100 p-2" data-testid={`combined-service-${s.service.id}`}>
                <p className="text-[13px] font-semibold text-slate-900">
                  {s.title} <span className="font-normal text-slate-500">({s.service.id})</span>
                </p>
                <StepList steps={s.steps} testid="combined-service-steps" />
                {canEdit && editing !== s.service.id && (
                  <button type="button" className={cn(big, 'mt-1 border border-slate-300 bg-white text-slate-800')} onClick={() => setEditing(s.service.id)} data-testid={`binding-edit-${s.service.id}`}>
                    Change service settings
                  </button>
                )}
                {editing === s.service.id && <BindingForm service={s.service} onDone={() => setEditing(null)} />}
              </div>
            ))
          )}
          {row.olderFields.length > 0 && <p className="mt-2 text-xs text-slate-600">On the older customer fields, as written: {row.olderFields.join(' · ')}.</p>}
        </section>
      </div>
    </li>
  );
}

/** One combined view, worked out already (no store), so it can be tested. */
export function CombinedViewContent({ view, canEdit, olts }: { view: CombinedView; canEdit: boolean; olts: readonly Equipment[] }) {
  const c = view.counts;
  return (
    <div data-testid="combined-view">
      <h3 className="text-base font-bold text-slate-900">{view.title}</h3>
      <p className="mb-2 text-xs text-slate-700" data-testid="combined-counts">
        {c.customers} customer{c.customers === 1 ? '' : 's'}: {c.agree} match, {c.disagree} do not match, {c.notDecided} not decided, {c.notRecorded} registration not recorded.
      </p>
      {view.findings.length > 0 && (
        <ul className="mb-3 space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-2 text-[13px] text-amber-950" data-testid="combined-findings">
          {view.findings.map((f) => (
            <li key={f.key}>⚠ {f.message}</li>
          ))}
        </ul>
      )}
      {view.rows.length === 0 ? (
        <p className="text-sm text-slate-600">No fibre customer is linked to this, or names it.</p>
      ) : (
        <ul className="space-y-3">
          {view.rows.map((r) => (
            <RowCard key={r.key} row={r} canEdit={canEdit} olts={olts} />
          ))}
        </ul>
      )}
    </div>
  );
}

function RulesSection() {
  const settings = useNetworkStore((s) => s.settings);
  const resolved = useMemo(() => resolveLogicalSettings(settings), [settings]);
  const canConfigure = useMayDo('configure');
  return (
    <details className="mb-3 rounded-lg border border-slate-200 bg-white p-2" data-testid="logical-rules">
      <summary className="min-h-12 cursor-pointer py-3 text-sm font-semibold text-slate-800 md:min-h-0 md:py-1">Rules used for service settings</summary>
      {LOGICAL_SETTING_DEFS.map((def) => {
        const on = resolved[def.key];
        const changed = settings.find((x) => x.id === def.id);
        return (
          <div key={def.id} className="mt-2 text-xs text-slate-700">
            <p className="font-semibold text-slate-900">
              {def.label}: {on ? 'On' : 'Off'}
            </p>
            <p>{def.source}</p>
            {changed?.updatedAt && (
              <p className="text-blue-800">
                Changed {changed.updatedAt.slice(0, 10)}
                {changed.updatedBy ? ` by ${changed.updatedBy}` : ''}
              </p>
            )}
            {canConfigure && (
              <button
                type="button"
                className={cn(big, 'mt-1 border border-slate-300 bg-white text-slate-800')}
                onClick={() => setLogicalSetting(def, !on, currentAccount()?.displayName ?? 'This device')}
              >
                {on ? 'Turn off' : 'Turn on'}
              </button>
            )}
          </div>
        );
      })}
    </details>
  );
}

/** The picker and the combined view for the network on this device. */
export function CombinedViewPanel({ target, onTarget }: { target: CombinedTarget | null; onTarget: (t: CombinedTarget) => void }) {
  const network = useNetworkStore(
    useShallow((s) => ({ equipment: s.equipment, cables: s.cables, splitters: s.splitters, closures: s.closures, customers: s.customers, onts: s.onts, services: s.services, settings: s.settings })),
  );
  const settings = useMemo(() => resolveLogicalSettings(network.settings), [network.settings]);
  const choices = useMemo(() => combinedTargets(network), [network]);
  const all = useMemo(() => findLogicalProblems(network, settings), [network, settings]);
  const view = useMemo(() => (target ? combinedView(network, target, settings) : null), [network, target, settings]);
  const canEdit = useMayDo('edit');
  const [filter, setFilter] = useState('');
  const olts = useMemo(() => network.equipment.filter((e) => e.type === 'OLT'), [network.equipment]);
  const keyOf = (t: CombinedTarget) => (t.kind === 'pon' ? `pon:${t.oltId}/${t.ponPortId}` : `${t.kind}:${t.id}`);
  const shown = choices.filter((c) => !filter.trim() || c.label.toLowerCase().includes(filter.trim().toLowerCase()) || c.key.toLowerCase().includes(filter.trim().toLowerCase()));
  const groups = ['OLT', 'PON port', 'Splitter', 'Customer'] as const;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 md:p-4" data-testid="combined-panel">
      <p className="mb-2 max-w-3xl text-xs text-slate-600">
        Left: what the fibre links reach. Right: the service settings a person recorded (the ONT's registration on the OLT, VLANs, profile, IP). Where they do not match it is
        marked ✕. No OLT is read yet, so nothing here is live.
      </p>
      <RulesSection />
      <p className="mb-2 text-xs text-slate-700" data-testid="logical-all-findings">
        {all.length === 0 ? 'No service settings to check across the network.' : `${all.length} thing${all.length === 1 ? '' : 's'} to check across the network.`}
      </p>
      <div className="mb-3 grid max-w-3xl grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="block text-xs text-slate-700">
          Find
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Name or id" className="mt-0.5 block min-h-12 w-full rounded-lg border border-slate-300 px-2 text-sm md:min-h-9" />
        </label>
        <label className="block text-xs text-slate-700">
          Show
          <select
            data-testid="combined-target"
            value={target ? keyOf(target) : ''}
            onChange={(e) => {
              const found = choices.find((c) => c.key === e.target.value);
              if (found) onTarget(found.target);
            }}
            className="mt-0.5 block min-h-12 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm md:min-h-9"
          >
            <option value="">Choose an OLT, PON port, splitter or customer</option>
            {groups.map((g) => {
              const list = shown.filter((c) => c.group === g);
              return list.length ? (
                <optgroup key={g} label={g}>
                  {list.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </optgroup>
              ) : null;
            })}
          </select>
        </label>
      </div>
      {view ? <CombinedViewContent view={view} canEdit={canEdit} olts={olts} /> : <p className="text-sm text-slate-600">Choose something to compare, or tap a line in the network tree.</p>}
      {all.length > 0 && !view && (
        <ul className="mt-3 space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-2 text-[13px] text-amber-950">
          {all.map((f) => (
            <li key={f.key}>⚠ {f.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
