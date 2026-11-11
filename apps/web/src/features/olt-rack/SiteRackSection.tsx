import { useState } from 'react';
import { Server } from 'lucide-react';

import { type Equipment, whereItSits } from '@fibergis/shared';

import { useOpenView } from '../../app/views';
import { Field, Input, Modal, Select } from '../../components/ui';
import { useNetworkStore } from '../../stores/networkStore';
import { placeItemInRack } from '../../stores/plantActions';
import { useUiStore } from '../../stores/uiStore';
import { InspectorSection } from '../inspector/sections';
import { RackElevation } from './RackElevation';
import { openSitesAndRacks } from './sitesTab';

const BIG = 'min-h-12 md:min-h-8';
const btn = `${BIG} rounded-lg border px-3 text-[14px] font-semibold md:text-[12px]`;
const MAIN = `${btn} border-blue-700 bg-blue-600 text-white hover:bg-blue-500 disabled:border-blue-300 disabled:bg-blue-300`;
const PLAIN = `${btn} border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:text-slate-400`;

/**
 * Phase 9: where an item sits: its site, rack and units, from the site and rack records. When no
 * record is linked, the older free text is shown "as written". Opens the rack drawing.
 */
export function SiteRackSection({ equipment }: { equipment: Equipment }) {
  const sites = useNetworkStore((s) => s.sites);
  const racks = useNetworkStore((s) => s.racks);
  const openView = useOpenView();
  const where = whereItSits({ sites, racks }, equipment);
  const [editing, setEditing] = useState(false);
  const [showRack, setShowRack] = useState(false);
  const [siteId, setSiteId] = useState(where.site?.id ?? '');
  const [rackId, setRackId] = useState(where.rack?.id ?? '');
  const [unit, setUnit] = useState(equipment.rackUnit?.toString() ?? '');
  const [tall, setTall] = useState(equipment.rackUnits?.toString() ?? '');
  const racksHere = racks.filter((r) => r.siteId === siteId);
  const linked = !!(equipment.siteId || equipment.rackId);

  const save = async () => {
    const done = await placeItemInRack(equipment.id, {
      siteId,
      ...(rackId ? { rackId } : {}),
      ...(rackId && unit ? { rackUnit: Number(unit) } : {}),
      ...(rackId && unit && tall ? { rackUnits: Number(tall) } : {}),
    });
    if (done) setEditing(false);
  };

  return (
    <InspectorSection title="Site and rack" icon={Server}>
      <div className="space-y-2 text-[13px]" data-testid="site-rack-section">
        <dl className="grid grid-cols-[5rem_1fr] gap-x-2 gap-y-1 text-xs">
          <dt className="text-slate-500">Site</dt>
          <dd className="font-semibold text-slate-800" data-testid="site-rack-site">{where.siteText}</dd>
          <dt className="text-slate-500">Rack</dt>
          <dd className="font-semibold text-slate-800" data-testid="site-rack-rack">{where.rackText}</dd>
          <dt className="text-slate-500">Units</dt>
          <dd className="font-semibold text-slate-800" data-testid="site-rack-units">{where.unitText}</dd>
        </dl>
        {where.fromFreeText && <p className="text-[11px] text-slate-500">"As written" is the older free text on this item. Choose the site and rack records to replace it on screen; the text is kept.</p>}

        {sites.length === 0 ? (
          <div className="space-y-2">
            <p className="text-xs text-slate-600">No sites recorded yet. Add the site and its racks first.</p>
            <button type="button" className={`${PLAIN} w-full`} onClick={() => { openSitesAndRacks(); openView('olt_rack'); }}>
              Open Sites and racks
            </button>
          </div>
        ) : editing ? (
          <div className="space-y-2 rounded-md border border-slate-200 bg-white p-2">
            <Field label="Site">
              <Select data-testid="site-rack-site-select" className={BIG} value={siteId} onChange={(e) => { setSiteId(e.target.value); setRackId(''); }}>
                <option value="">Choose…</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Rack">
              <Select data-testid="site-rack-rack-select" className={BIG} value={rackId} disabled={!siteId} onChange={(e) => setRackId(e.target.value)}>
                <option value="">Not in a rack, or rack not known</option>
                {racksHere.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.heightUnits ? ` (${r.heightUnits} units)` : ''}
                  </option>
                ))}
              </Select>
            </Field>
            {rackId && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Lowest unit it fills" hint="Read the number on the rack rail">
                  <Input data-testid="site-rack-unit" className={BIG} inputMode="numeric" value={unit} onChange={(e) => setUnit(e.target.value.replace(/\D/g, ''))} />
                </Field>
                <Field label="Units tall" hint="Empty if not known">
                  <Input data-testid="site-rack-tall" className={BIG} inputMode="numeric" value={tall} disabled={!unit} onChange={(e) => setTall(e.target.value.replace(/\D/g, ''))} />
                </Field>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={PLAIN} onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button type="button" className={MAIN} data-testid="site-rack-save" disabled={!siteId} onClick={() => void save()}>
                Save place
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={PLAIN} data-testid="site-rack-edit" onClick={() => {
                setSiteId(where.site?.id ?? '');
                setRackId(where.rack?.id ?? '');
                setUnit(equipment.rackUnit?.toString() ?? '');
                setTall(equipment.rackUnits?.toString() ?? '');
                setEditing(true);
              }}>
              {linked ? 'Change place' : 'Choose site and rack'}
            </button>
            {where.rack && (
              <button type="button" className={MAIN} data-testid="site-rack-show" onClick={() => setShowRack(true)}>
                Show rack
              </button>
            )}
            {linked && (
              <button type="button" className={PLAIN} onClick={() => void placeItemInRack(equipment.id, null)}>
                Clear place
              </button>
            )}
          </div>
        )}
      </div>
      {showRack && where.rack && (
        <Modal open onClose={() => setShowRack(false)} title={`Rack ${where.rack.name}`} description="What sits in each unit, as recorded" icon={Server} size="md">
          <RackElevation
            rack={where.rack}
            highlightId={equipment.id}
            onOpenItem={(item) => {
              useUiStore.getState().select({ type: 'equipment', data: item });
              setShowRack(false);
            }}
          />
        </Modal>
      )}
    </InspectorSection>
  );
}
