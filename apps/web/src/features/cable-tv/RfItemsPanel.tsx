import { RF_KIND_INFO, type RfElement,rfPowerWord } from '@fibergis/shared';

import { useNetworkStore } from '../../stores/networkStore';
import { deleteRfElement } from '../../stores/rfActions';
import { RfItemForm } from './RfItemForm';
import type { RfModel } from './useRfModel';

const nr = 'Not recorded';

function details(el: RfElement): string {
  const parts: string[] = [];
  if (el.kind === 'rf_amplifier') parts.push(`gain ${el.gainDb ?? nr} dB`, `tilt ${el.tiltDb ?? nr} dB`, `power ${el.powerFeed ?? nr}`);
  if (el.kind === 'optical_node' || el.kind === 'mini_node') {
    parts.push(el.ratedOutputDbuv !== undefined ? `rated ${el.ratedOutputDbuv} dBµV at ${el.ratedAtInputDbm ?? '?'} dBm` : `rated output ${nr}`);
  }
  if (el.kind === 'optical_transmitter') parts.push(`wavelength ${el.wavelengthNm ?? nr}${el.wavelengthNm ? ' nm' : ''}`);
  if (el.kind === 'edfa') parts.push(el.edfaKind === 'wdm' ? 'WDM EDFA (PON pass port)' : el.edfaKind === 'plain' ? 'plain EDFA' : `kind ${nr}`);
  const losses = el.ports.filter((p) => p.direction === 'out' && ['tap', 'rf_splitter', 'directional_coupler', 'optical_splitter', 'wdm', 'power_inserter'].includes(el.kind));
  if (losses.length) parts.push(losses.map((p) => `${p.label} ${p.lossDb ?? nr}${p.lossDb !== undefined ? ' dB' : ''}`).join(', '));
  if (el.serialNumber) parts.push(`serial ${el.serialNumber}`);
  if (el.valuesSource) parts.push(`values from: ${el.valuesSource}`);
  return parts.join(' · ');
}

/** Every Cable TV item on record, and the form to add one. */
export function RfItemsPanel({ model }: { model: RfModel }) {
  const equipment = useNetworkStore((s) => s.equipment);
  const customers = useNetworkStore((s) => s.customers);
  const site = (id?: string) => (id ? equipment.find((e) => e.id === id)?.name ?? `${id} (not on record)` : 'Not placed at a pin');
  return (
    <div className="space-y-4">
      <RfItemForm model={model} />
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h4 className="mb-2 text-sm font-bold text-slate-800">Items on record ({model.data.rfElements.length})</h4>
        {model.data.rfElements.length === 0 ? (
          <p className="text-sm text-slate-600">Not recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs" data-testid="rf-items">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1 pr-2">Name</th>
                  <th className="py-1 pr-2">Kind</th>
                  <th className="py-1 pr-2">Power</th>
                  <th className="py-1 pr-2">Where</th>
                  <th className="py-1 pr-2">Values (as entered)</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {model.data.rfElements.map((el) => (
                  <tr key={el.id} className="align-top" data-testid={`rf-item-${el.name}`}>
                    <td className="py-1.5 pr-2 font-semibold text-slate-900">{el.name}</td>
                    <td className="py-1.5 pr-2">{RF_KIND_INFO[el.kind].label}</td>
                    <td className="py-1.5 pr-2">{rfPowerWord(el)}</td>
                    <td className="py-1.5 pr-2">{el.customerId ? `Customer ${customers.find((c) => c.id === el.customerId)?.name ?? el.customerId}` : site(el.siteEquipmentId)}</td>
                    <td className="py-1.5 pr-2 text-slate-700">{details(el) || '—'}</td>
                    <td className="py-1.5 text-right">
                      <button type="button" className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50" onClick={() => void deleteRfElement(el.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
