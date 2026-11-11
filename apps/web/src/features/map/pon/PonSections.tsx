import { useMemo } from 'react';
import { Radio } from 'lucide-react';

import { type Cable, coreIdentity, type Customer, type PonSummary } from '@fibergis/shared';

import { selectColorSchemes, useNetworkStore } from '../../../stores/networkStore';
import { FiberSwatch } from '../../fiber/FiberChip';
import { InspectorSection } from '../../inspector/sections';
import { formatDbm, ponColor } from './ponColors';
import { usePonMapStore } from './ponMapStore';
import { usePonOverview } from './usePonOverview';

function PonChip({ pon }: { pon: PonSummary }) {
  const color = ponColor(pon.portNumber);
  const setFocus = usePonMapStore((s) => s.setFocus);
  return (
    <button
      type="button"
      onClick={() => setFocus(pon.key)}
      title="Light up this PON on the map"
      className="rounded px-1.5 py-0.5 text-[11px] font-extrabold"
      style={{ background: color.hex, color: color.ink }}
    >
      {pon.ponPortId}
    </button>
  );
}

const isUsed = (core: Cable['cores'][number]) => core.status === 'In Use' || !!core.assignments?.some((a) => !a.releasedAt);

/** Which PON a cable carries, the area it serves, and each fiber used or free, by colour. */
export function CablePonSection({ cable }: { cable: Cable }) {
  const overview = usePonOverview();
  const schemes = useNetworkStore((s) => selectColorSchemes(s));
  const use = overview.cables.get(cable.id);
  const pons = (use?.ponKeys ?? []).map((k) => overview.pons.find((p) => p.key === k)).filter((p): p is PonSummary => !!p);
  const cores = useMemo(() => [...cable.cores].sort((a, b) => a.coreNumber - b.coreNumber), [cable.cores]);
  if (cable.cableCategory === 'Coaxial') return null;
  return (
    <InspectorSection title="PON and fibers" icon={Radio} aside={pons.map((p) => p.ponPortId).join(', ') || undefined}>
      <div className="space-y-2 text-[12px]">
        {pons.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {pons.map((p) => (
              <PonChip key={p.key} pon={p} />
            ))}
            <span className="text-slate-600">
              {cable.type} · serves {[...new Set(pons.flatMap((p) => p.areas.slice(0, 2).map((a) => a.name)))].join(', ') || 'no customers yet'}
            </span>
          </div>
        ) : (
          <p className="text-slate-600">No PON reaches this cable on its recorded fibers. Link its fibers (splices, splitter or ODF) to trace one.</p>
        )}
        <div className="flex flex-wrap gap-1" aria-label="Fibers, used and free">
          {cores.map((k) => {
            const used = isUsed(k);
            return (
              <span
                key={k.coreNumber}
                title={`Fiber ${k.coreNumber}: ${used ? 'used' : k.status}`}
                className={`flex items-center gap-0.5 rounded border px-1 py-0.5 text-[10px] font-semibold tabular-nums ${used ? 'border-slate-700 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-500'}`}
              >
                <FiberSwatch identity={coreIdentity(cable, k.coreNumber, schemes)} size={9} />
                {k.coreNumber}
              </span>
            );
          })}
        </div>
        {use && (
          <p className="text-slate-600">
            <b className="text-slate-900">{use.coresUsed}</b> used · <b className="text-slate-900">{use.coresFree}</b> free of {use.coresTotal}. Dark tiles are used.
          </p>
        )}
      </div>
    </InspectorSection>
  );
}

/** The customer's PON, area, splitter output and estimated light, from recorded fibers only. */
export function CustomerPonSection({ customer }: { customer: Customer }) {
  const overview = usePonOverview();
  const splitters = useNetworkStore((s) => s.splitters);
  const onPon = overview.customers.get(customer.id);
  const pon = onPon ? overview.pons.find((p) => p.key === onPon.ponKey) : undefined;
  const chain = (onPon?.splitterIds ?? []).map((id) => splitters.find((s) => s.id === id)).filter((s) => !!s);
  return (
    <InspectorSection title="PON and light" icon={Radio} aside={pon?.ponPortId}>
      {pon && onPon ? (
        <div className="space-y-1.5 text-[12px] text-slate-700">
          <div className="flex flex-wrap items-center gap-1.5">
            <PonChip pon={pon} />
            <span>
              {pon.vendorAddress ? `${pon.vendorAddress} · ` : ''}
              {pon.oltName}
            </span>
          </div>
          <div>
            Splitters: {chain.map((s) => `${s!.ratio} in ${s!.terminalBoxId.replace(/^VJA-/, '')}`).join(' → ')}
            {customer.splitterOutputPort ? `, output ${customer.splitterOutputPort}` : ''}
          </div>
          <div>
            Light at ONT: <b className="text-sky-700">{formatDbm(onPon.rxDbm)}</b> <span className="text-slate-500">(estimated)</span>
          </div>
          <div className="text-slate-500">
            {customer.status === 'Active' ? 'Active customer' : `Inactive: ${customer.status}`} · PON has {pon.customers.active} active, {pon.customers.total - pon.customers.active} inactive, {pon.accessOutputs.free} free outputs
          </div>
        </div>
      ) : (
        <p className="text-[12px] text-slate-600">Not on a PON yet: this customer&apos;s fibers are not recorded from the box back to the OLT.</p>
      )}
    </InspectorSection>
  );
}
