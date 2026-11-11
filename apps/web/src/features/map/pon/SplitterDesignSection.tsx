import { useMemo } from 'react';
import { ArrowDown, Workflow } from 'lucide-react';

import { coreIdentity, type Equipment, type Splitter, type SplitterSummary } from '@fibergis/shared';

import { cn } from '../../../components/ui';
import { selectColorSchemes, useNetworkStore } from '../../../stores/networkStore';
import { FiberSwatch } from '../../fiber/FiberChip';
import { InspectorSection } from '../../inspector/sections';
import { capacityTone, formatDbm, ponColor, TONE_COLORS } from './ponColors';
import { usePonOverview } from './usePonOverview';

const PORT_STYLE: Record<string, string> = {
  used: 'border-transparent text-white',
  free: 'border-slate-200 bg-white text-slate-500',
  reserved: 'border-amber-300 bg-amber-50 text-amber-800',
  faulty: 'border-rose-300 bg-rose-50 text-rose-700',
};

function portState(p: Splitter['outputPorts'][number]): 'used' | 'free' | 'reserved' | 'faulty' {
  if (p.status === 'Occupied' || p.connectedCustomerId || p.connectedDropCableId) return 'used';
  if (p.status === 'Faulty') return 'faulty';
  if (p.status === 'Reserved') return 'reserved';
  return 'free';
}

function SplitterDiagram({ splitter, summary }: { splitter: Splitter; summary?: SplitterSummary }) {
  const overview = usePonOverview();
  const cables = useNetworkStore((s) => s.cables);
  const customers = useNetworkStore((s) => s.customers);
  const splitters = useNetworkStore((s) => s.splitters);
  const schemes = useNetworkStore((s) => selectColorSchemes(s));
  const cableById = useMemo(() => new Map(cables.map((c) => [c.id, c])), [cables]);
  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const pon = summary?.ponKey ? overview.pons.find((p) => p.key === summary.ponKey) : undefined;
  const chip = pon ? ponColor(pon.portNumber) : undefined;

  const inputCable = splitter.inputPort.connectedCableId ? cableById.get(splitter.inputPort.connectedCableId) : undefined;
  const inputCore = splitter.inputPort.connectedCore;
  const parent = splitter.inputPort.connectedSplitterId ? splitters.find((s) => s.id === splitter.inputPort.connectedSplitterId) : undefined;
  const outputs = summary?.outputs;
  const tone = outputs ? TONE_COLORS[capacityTone(outputs.free, outputs.total)] : undefined;

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5" data-testid={`splitter-design-${splitter.id}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        {chip && pon ? (
          <span className="rounded px-1.5 py-0.5 text-[11px] font-extrabold" style={{ background: chip.hex, color: chip.ink }}>
            {pon.ponPortId}
          </span>
        ) : (
          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-bold text-slate-600">PON not traced</span>
        )}
        <span className="text-[13px] font-bold text-slate-900">
          {splitter.ratio} {splitter.kind ?? 'splitter'}
        </span>
        <span className="text-[11px] text-slate-500">
          {summary?.stage ? `Stage ${summary.stage} from the OLT` : 'Stage not known'} · {summary?.access ? 'feeds customers' : 'feeds more splitters'}
        </span>
      </div>

      {/* Input → splitter → outputs, with the estimated level at each point. */}
      <div className="flex items-center gap-2 rounded-md bg-white px-2 py-1.5 text-[12px]">
        <span className="text-[10.5px] font-semibold uppercase text-slate-400">In</span>
        {inputCable && inputCore ? (
          <>
            <FiberSwatch identity={coreIdentity(inputCable, inputCore, schemes)} />
            <span className="min-w-0 flex-1 truncate text-slate-700">
              {inputCable.name}, fiber {inputCore}
            </span>
          </>
        ) : parent ? (
          <span className="min-w-0 flex-1 truncate text-slate-700">From {parent.name}, output {splitter.inputPort.connectedSplitterPort}</span>
        ) : (
          <span className="min-w-0 flex-1 text-amber-700">Input fiber not recorded</span>
        )}
        <span className="font-semibold tabular-nums text-sky-700">{formatDbm(summary?.inputDbm)}</span>
      </div>
      <div className="flex items-center justify-center gap-2 text-[11px] text-slate-500">
        <ArrowDown size={12} /> loss {summary?.lossDb ?? splitter.insertionLossDb} dB <ArrowDown size={12} />
        <span className="font-semibold tabular-nums text-sky-700">each output {formatDbm(summary?.outputDbm)}</span>
      </div>
      <div className="text-[10px] text-slate-500">Outputs: customer and estimated light at the ONT (dBm). Grey: inactive customer.</div>

      <div className="grid grid-cols-4 gap-1">
        {splitter.outputPorts.map((p) => {
          const state = portState(p);
          const customer = p.connectedCustomerId ? customerById.get(p.connectedCustomerId) : undefined;
          const drop = p.connectedDropCableId ? cableById.get(p.connectedDropCableId) : undefined;
          const rx = customer ? overview.customers.get(customer.id)?.rxDbm : undefined;
          const inactive = customer && customer.status !== 'Active';
          const child = splitters.find((s) => s.inputPort.connectedCableId === p.connectedDropCableId && s.inputPort.connectedCore === p.connectedCore);
          return (
            <div
              key={p.portNumber}
              className={cn('flex min-h-[58px] flex-col rounded-md border px-1.5 py-1 text-[10.5px] leading-tight', PORT_STYLE[state])}
              style={state === 'used' && chip ? { background: inactive ? '#94a3b8' : chip.hex, color: inactive ? '#fff' : chip.ink } : state === 'used' ? { background: '#475569' } : undefined}
              title={customer ? `${customer.name} (${customer.status})` : child ? `Feeds ${child.name}` : state}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="font-extrabold">{p.portNumber}</span>
                {drop && p.connectedCore && <FiberSwatch identity={coreIdentity(drop, p.connectedCore, schemes)} size={10} />}
              </div>
              <span className="truncate font-semibold">{customer ? customer.name.split(' ')[0] : child ? child.name.replace(/^SPL-\S+\s*/, '') : state === 'free' ? 'Free' : state}</span>
              {customer && <span className="truncate opacity-90">{inactive ? customer.status : rx !== undefined ? rx.toFixed(1) : 'Rx not calc.'}</span>}
            </div>
          );
        })}
      </div>

      {outputs && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px]">
          <span className="font-bold" style={{ color: tone }}>
            {outputs.free} free · can add {outputs.free} new connection{outputs.free === 1 ? '' : 's'}
          </span>
          <span className="text-slate-500">
            {outputs.used} used · {outputs.reserved} reserved · {outputs.faulty} faulty
          </span>
        </div>
      )}
    </div>
  );
}

/** For a box holding splitters: the PON it is on, and each splitter's design, leads and estimated light. */
export function SplitterDesignSection({ host }: { host: Equipment }) {
  const overview = usePonOverview();
  const splitters = useNetworkStore((s) => s.splitters);
  const here = useMemo(() => splitters.filter((s) => s.terminalBoxId === host.id).sort((a, b) => (overview.splitters.get(a.id)?.stage ?? 9) - (overview.splitters.get(b.id)?.stage ?? 9)), [splitters, host.id, overview]);
  if (here.length === 0) return null;
  const pons = (overview.equipment.get(host.id) ?? []).map((k) => overview.pons.find((p) => p.key === k)).filter((p) => !!p);
  return (
    <InspectorSection title="Splitter design and light" icon={Workflow} aside={pons.map((p) => p!.ponPortId).join(', ') || undefined}>
      <div className="space-y-2">
        {pons.map((p) => (
          <p key={p!.key} className="text-[12px] text-slate-600">
            On <b>{p!.ponPortId}</b>
            {p!.vendorAddress ? ` (${p!.vendorAddress})` : ''} of {p!.oltName}, serving {p!.areas.map((a) => a.name).join(', ') || 'no customers yet'}.
          </p>
        ))}
        {here.map((sp) => (
          <SplitterDiagram key={sp.id} splitter={sp} summary={overview.splitters.get(sp.id)} />
        ))}
        <p className="text-[10.5px] text-slate-500">Light levels are estimated from the OLT&apos;s recorded launch power and the Optical settings. Measure with a power meter to confirm.</p>
      </div>
    </InspectorSection>
  );
}
