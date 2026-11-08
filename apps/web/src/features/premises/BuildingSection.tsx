import { useMemo, useState } from 'react';
import { Building2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { type Building, BUILDING_KIND_LABELS, BUILDING_KINDS, type BuildingKind, buildingUnitPaths, type Equipment } from '@fibergis/shared';

import { Button, Field, Input, Select } from '../../components/ui';
import { addBuildingFloorBox, addUnit, removeUnit, saveBuilding, setUpBuilding } from '../../stores/connectionActions';
import { selectOpticalSettings, useNetworkStore } from '../../stores/networkStore';
import { InspectorSection } from '../inspector/sections';

const STEP_TONE = { ok: 'text-slate-800', warning: 'text-amber-700', gap: 'text-red-700' } as const;

/** On a Building Entry Point pin: set up the building, or show its riser, floor boxes and units. */
export function BuildingSection({ equipment }: { equipment: Equipment }) {
  const building = useNetworkStore((s) => s.buildings.find((b) => b.entryEquipmentId === equipment.id));
  return (
    <InspectorSection title="Building" icon={Building2}>
      {building ? <BuildingDetails building={building} /> : <BuildingSetup equipment={equipment} />}
    </InspectorSection>
  );
}

function BuildingSetup({ equipment }: { equipment: Equipment }) {
  const [name, setName] = useState(equipment.buildingName ?? '');
  const [kind, setKind] = useState<BuildingKind>('apartment');
  const [floors, setFloors] = useState('');
  return (
    <div className="space-y-2" data-testid="bld-setup-form">
      <p className="text-xs text-slate-600">No building record yet. Set one up to record its riser, floor boxes and flats.</p>
      <Field label="Building name or address" required>
        <Input data-testid="bld-name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Kind">
          <Select data-testid="bld-kind" value={kind} onChange={(e) => setKind(e.target.value as BuildingKind)}>
            {BUILDING_KINDS.map((k) => (
              <option key={k} value={k}>
                {BUILDING_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Floors above ground">
          <Input data-testid="bld-floors" inputMode="numeric" value={floors} onChange={(e) => setFloors(e.target.value.replace(/\D/g, ''))} />
        </Field>
      </div>
      <Button
        size="sm"
        variant="primary"
        data-testid="bld-setup"
        disabled={!name.trim()}
        onClick={() => void setUpBuilding({ name, kind, entryEquipmentId: equipment.id, ...(floors ? { floorsAbove: Number(floors) } : {}) })}
      >
        Set up building
      </Button>
    </div>
  );
}

function BuildingDetails({ building }: { building: Building }) {
  const network = useNetworkStore(useShallow((s) => ({ equipment: s.equipment, cables: s.cables, splitters: s.splitters, closures: s.closures, customers: s.customers, onts: s.onts, buildings: s.buildings })));
  const optical = useNetworkStore(selectOpticalSettings);
  const paths = useMemo(() => buildingUnitPaths(building, network, { settings: optical }), [building, network, optical]);
  const [riser, setRiser] = useState(building.riserCableId ?? '');
  const [boxLabel, setBoxLabel] = useState('');
  const [boxFloor, setBoxFloor] = useState('');
  const [boxSplitter, setBoxSplitter] = useState('');
  const [unitLabel, setUnitLabel] = useState('');
  const [unitFloor, setUnitFloor] = useState('');
  const [unitBox, setUnitBox] = useState('');
  const multi = building.kind !== 'house';
  const entryCables = network.cables.filter((c) => c.startEquipmentId === building.entryEquipmentId || c.endEquipmentId === building.entryEquipmentId);
  const riserChoices = entryCables.length ? entryCables : network.cables;
  return (
    <div className="space-y-3 text-[13px]" data-testid="bld-details">
      <p>
        <span className="font-semibold">{building.name}</span> · {BUILDING_KIND_LABELS[building.kind]}
        {building.floorsAbove !== undefined ? ` · ${building.floorsAbove} floors` : ''}
      </p>
      {multi && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-slate-600">Riser</p>
          <div className="flex items-end gap-2">
            <Field label="Cable from the entry up the building" className="flex-1">
              <Select data-testid="bld-riser" value={riser} onChange={(e) => setRiser(e.target.value)}>
                <option value="">Not recorded</option>
                {riserChoices.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.fiberCount}F)
                  </option>
                ))}
              </Select>
            </Field>
            <Button size="sm" data-testid="bld-riser-save" disabled={riser === (building.riserCableId ?? '')} onClick={() => void saveBuilding(building.id, { riserCableId: riser || undefined })}>
              Save
            </Button>
          </div>
        </div>
      )}
      {multi && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-slate-600">Floor boxes ({building.floorBoxes.length})</p>
          <ul className="text-xs text-slate-700">
            {building.floorBoxes.map((f) => (
              <li key={f.id}>
                {f.label}
                {f.floor ? ` · floor ${f.floor}` : ''}
                {f.splitterId ? ` · splitter ${network.splitters.find((s) => s.id === f.splitterId)?.name ?? f.splitterId}` : ''}
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Box name">
              <Input data-testid="flb-label" value={boxLabel} onChange={(e) => setBoxLabel(e.target.value)} />
            </Field>
            <Field label="Floor">
              <Input data-testid="flb-floor" value={boxFloor} onChange={(e) => setBoxFloor(e.target.value)} />
            </Field>
            <Field label="Splitter in it">
              <Select data-testid="flb-splitter" value={boxSplitter} onChange={(e) => setBoxSplitter(e.target.value)}>
                <option value="">None</option>
                {network.splitters.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Button
            size="sm"
            data-testid="flb-add"
            disabled={!boxLabel.trim()}
            onClick={() =>
              void addBuildingFloorBox(building.id, { label: boxLabel, floor: boxFloor, ...(boxSplitter ? { splitterId: boxSplitter } : {}) }).then((done) => {
                if (done) {
                  setBoxLabel('');
                  setBoxFloor('');
                  setBoxSplitter('');
                }
              })
            }
          >
            Add floor box
          </Button>
        </div>
      )}
      <div className="space-y-1">
        <p className="text-xs font-semibold text-slate-600">Units and how fiber reaches each ({building.units.length})</p>
        {paths.map((p) => (
          <div key={`${p.unit.id}/${p.customer?.id ?? 'none'}`} className="rounded-md border border-slate-200 bg-white p-2" data-testid={`unit-path-${p.unit.label}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">
                {p.unit.label}
                {p.unit.floor ? ` · floor ${p.unit.floor}` : ''}
              </span>
              <span className={p.gaps.length ? 'text-xs text-red-700' : 'text-xs text-slate-500'}>{p.gaps.length ? `${p.gaps.length} missing` : 'Every link recorded'}</span>
            </div>
            <ol className="mt-1 space-y-0.5 text-xs">
              {p.steps.map((s, i) => (
                <li key={i} className={STEP_TONE[s.status]}>
                  {s.status === 'gap' ? 'Missing: ' : ''}
                  {s.label}
                  {s.detail ? <span className="text-slate-500"> · {s.detail}</span> : null}
                </li>
              ))}
            </ol>
            {!p.customer && (
              <Button size="xs" className="mt-1" data-testid={`unit-remove-${p.unit.label}`} onClick={() => void removeUnit(building.id, p.unit.id)}>
                Remove unit
              </Button>
            )}
          </div>
        ))}
        <div className="grid grid-cols-3 gap-2">
          <Field label="Flat or shop">
            <Input data-testid="unit-label" value={unitLabel} placeholder="302" onChange={(e) => setUnitLabel(e.target.value)} />
          </Field>
          <Field label="Floor">
            <Input data-testid="unit-floor" value={unitFloor} onChange={(e) => setUnitFloor(e.target.value)} />
          </Field>
          {multi ? (
            <Field label="Floor box">
              <Select data-testid="unit-box" value={unitBox} onChange={(e) => setUnitBox(e.target.value)}>
                <option value="">Not recorded</option>
                {building.floorBoxes.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <span />
          )}
        </div>
        <Button
          size="sm"
          data-testid="unit-add"
          disabled={!unitLabel.trim()}
          onClick={() =>
            void addUnit(building.id, { label: unitLabel, floor: unitFloor, ...(unitBox ? { floorBoxId: unitBox } : {}) }).then((done) => {
              if (done) setUnitLabel('');
            })
          }
        >
          Add unit
        </Button>
        <p className="text-[11px] text-slate-500">Put a customer in a unit from the customer's panel, under Building and unit.</p>
      </div>
    </div>
  );
}
