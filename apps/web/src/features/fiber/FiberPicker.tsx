import { type Cable, coreIdentity } from '@fibergis/shared';

import { Field, Input, Select } from '../../components/ui';
import { selectColorSchemes, useNetworkStore } from '../../stores/networkStore';
import { FiberSwatch } from './FiberChip';
import type { FiberChoice } from './fiberUi';

/**
 * Choose a cable, then a fiber number. Nothing is chosen for the person: both start empty. The
 * fiber's identity (tube, colour if the scheme is known) is shown under the number.
 */
export function FiberPicker({
  label,
  value,
  onChange,
  cables,
  testId,
}: {
  label: string;
  value: FiberChoice;
  onChange: (next: FiberChoice) => void;
  /** Cables to list first (for example those recorded at this place). */
  cables: readonly Cable[];
  testId: string;
}) {
  const all = useNetworkStore((s) => s.cables);
  const schemes = useNetworkStore(selectColorSchemes);
  const listed = new Set(cables.map((c) => c.id));
  const rest = all.filter((c) => !listed.has(c.id) && c.cableCategory !== 'Coaxial');
  const cable = all.find((c) => c.id === value.cableId);
  const n = Number(value.core);
  const identity = cable && n > 0 ? coreIdentity(cable, n, schemes) : undefined;

  return (
    <div className="grid grid-cols-[1fr_5rem] gap-2">
      <Field label={label}>
        <Select data-testid={`${testId}-cable`} value={value.cableId} onChange={(e) => onChange({ cableId: e.target.value, core: '' })}>
          <option value="">Choose a cable…</option>
          {cables.length > 0 && (
            <optgroup label="Recorded here">
              {cables.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.fiberCount}F)
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Other cables">
            {rest.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.fiberCount}F)
              </option>
            ))}
          </optgroup>
        </Select>
      </Field>
      <Field label="Fiber">
        <Input
          data-testid={`${testId}-core`}
          inputMode="numeric"
          value={value.core}
          disabled={!cable}
          onChange={(e) => onChange({ ...value, core: e.target.value.replace(/\D/g, '') })}
        />
      </Field>
      {identity && (
        <p className="col-span-2 -mt-1 flex items-center gap-1.5 text-[11px] text-slate-600" data-testid={`${testId}-identity`}>
          <FiberSwatch identity={identity} size={11} />
          {identity.label}
        </p>
      )}
    </div>
  );
}
