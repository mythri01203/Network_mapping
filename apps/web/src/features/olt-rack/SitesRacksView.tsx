import { useState } from 'react';
import { Building2, Plus, Server, Trash2 } from 'lucide-react';

import { type Rack, RACK_NUMBERING_LABELS, RACK_NUMBERINGS, type RackNumbering, type Site } from '@fibergis/shared';

import { useShowOnMap } from '../../app/views';
import { Field, Input, Select, Textarea } from '../../components/ui';
import { useNetworkStore } from '../../stores/networkStore';
import { addRack, addSite, removeRack, removeSite, saveRack, saveSite } from '../../stores/plantActions';
import { RackElevation } from './RackElevation';

const BIG = 'min-h-12 md:min-h-9';
const btn = `${BIG} inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 text-[14px] font-semibold md:text-[13px]`;
const MAIN = `${btn} border-blue-700 bg-blue-600 text-white hover:bg-blue-500 disabled:border-blue-300 disabled:bg-blue-300`;
const PLAIN = `${btn} border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:text-slate-400`;
const DANGER = `${btn} border-red-200 bg-white text-red-700 hover:bg-red-50`;

type SiteForm = { name: string; kind: string; address: string; notes: string };
type RackForm = { name: string; heightUnits: string; numbering: RackNumbering | ''; location: string; notes: string; siteId?: string };

const siteForm = (s?: Site): SiteForm => ({ name: s?.name ?? '', kind: s?.kind ?? '', address: s?.address ?? '', notes: s?.notes ?? '' });
const rackForm = (r?: Rack): RackForm => ({ name: r?.name ?? '', heightUnits: r?.heightUnits?.toString() ?? '', numbering: r?.numbering ?? '', location: r?.location ?? '', notes: r?.notes ?? '' });

/**
 * Phase 9: sites and their racks, and a drawing of each rack. Lists only what is recorded; a site
 * position, rack height or numbering left empty stays "not recorded".
 */
export function SitesRacksView() {
  const sites = useNetworkStore((s) => s.sites);
  const racks = useNetworkStore((s) => s.racks);
  const equipment = useNetworkStore((s) => s.equipment);
  const showOnMap = useShowOnMap();
  const [siteId, setSiteId] = useState<string>(sites[0]?.id ?? '');
  const [rackId, setRackId] = useState<string>('');
  const [newSite, setNewSite] = useState<SiteForm | null>(null);
  const [editSite, setEditSite] = useState<SiteForm | null>(null);
  const [newRack, setNewRack] = useState<RackForm | null>(null);
  const [editRack, setEditRack] = useState<RackForm | null>(null);

  const site = sites.find((s) => s.id === siteId) ?? sites[0];
  const siteRacks = site ? racks.filter((r) => r.siteId === site.id) : [];
  const rack = siteRacks.find((r) => r.id === rackId) ?? siteRacks[0];
  const looseAtSite = site ? equipment.filter((e) => e.siteId === site.id && !e.rackId) : [];

  const rackDraft = (f: RackForm, forSite: string) => ({
    siteId: forSite,
    name: f.name,
    heightUnits: f.heightUnits ? Number(f.heightUnits) : undefined,
    numbering: f.numbering || undefined,
    location: f.location,
    notes: f.notes,
  });

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-4 text-slate-900 md:p-6" data-testid="sites-racks-view">
      <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-[18rem_1fr]">
        {/* Sites */}
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Building2 size={16} /> Sites
          </h2>
          {sites.length === 0 && <p className="text-xs text-slate-600">No sites recorded. Add the exchange, hub room or POP where racks stand.</p>}
          <ul className="space-y-1.5">
            {sites.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  data-testid={`site-${s.id}`}
                  onClick={() => { setSiteId(s.id); setRackId(''); setEditSite(null); setEditRack(null); }}
                  className={`flex min-h-12 w-full flex-col items-start justify-center rounded-lg border px-3 py-1 text-left ${site?.id === s.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                >
                  <span className="text-[14px] font-semibold">{s.name}</span>
                  <span className="text-[11px] text-slate-600">
                    {[s.kind, `${racks.filter((r) => r.siteId === s.id).length} rack(s)`].filter(Boolean).join(' · ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {newSite ? (
            <SiteFields form={newSite} onChange={setNewSite}>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className={PLAIN} onClick={() => setNewSite(null)}>Cancel</button>
                <button
                  type="button"
                  className={MAIN}
                  data-testid="site-save-new"
                  disabled={!newSite.name.trim()}
                  onClick={async () => {
                    const made = await addSite(newSite);
                    if (made) { setNewSite(null); setSiteId(made.id); }
                  }}
                >
                  Save site
                </button>
              </div>
            </SiteFields>
          ) : (
            <button type="button" className={`${PLAIN} w-full`} data-testid="site-add" onClick={() => setNewSite(siteForm())}>
              <Plus size={16} /> Add a site
            </button>
          )}
        </section>

        {/* The chosen site, its racks and the rack drawing */}
        {site && (
          <section className="space-y-3">
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              {editSite ? (
                <SiteFields form={editSite} onChange={setEditSite}>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" className={PLAIN} onClick={() => setEditSite(null)}>Cancel</button>
                    <button type="button" className={MAIN} disabled={!editSite.name.trim()} onClick={async () => { if (await saveSite(site.id, { ...editSite, lat: site.lat, lng: site.lng })) setEditSite(null); }}>
                      Save site
                    </button>
                  </div>
                </SiteFields>
              ) : (
                <div className="space-y-1">
                  <p className="text-[15px] font-bold">{site.name}</p>
                  <p className="text-xs text-slate-600">
                    {site.kind ?? 'Kind not recorded'} · {site.address ?? 'Address not recorded'} · {site.lat !== undefined ? 'Position recorded' : 'Map position not recorded'}
                  </p>
                  {site.notes && <p className="whitespace-pre-line text-xs text-slate-700">{site.notes}</p>}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button type="button" className={PLAIN} onClick={() => setEditSite(siteForm(site))}>Change site</button>
                    <button type="button" className={DANGER} onClick={() => void removeSite(site.id)}>
                      <Trash2 size={15} /> Delete site
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-bold">
                <Server size={16} /> Racks at {site.name}
              </h3>
              {siteRacks.length === 0 && <p className="text-xs text-slate-600">No racks recorded at this site.</p>}
              <div className="flex flex-wrap gap-1.5">
                {siteRacks.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    data-testid={`rack-${r.id}`}
                    onClick={() => { setRackId(r.id); setEditRack(null); }}
                    className={`min-h-12 rounded-lg border px-3 text-[13px] font-semibold md:min-h-9 ${rack?.id === r.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                  >
                    {r.name}
                    <span className="ml-1 text-[11px] font-normal text-slate-600">{r.heightUnits ? `${r.heightUnits}U` : 'height not recorded'}</span>
                  </button>
                ))}
              </div>
              {newRack ? (
                <RackFields form={newRack} onChange={setNewRack}>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" className={PLAIN} onClick={() => setNewRack(null)}>Cancel</button>
                    <button
                      type="button"
                      className={MAIN}
                      data-testid="rack-save-new"
                      disabled={!newRack.name.trim()}
                      onClick={async () => {
                        const made = await addRack(rackDraft(newRack, site.id));
                        if (made) { setNewRack(null); setRackId(made.id); }
                      }}
                    >
                      Save rack
                    </button>
                  </div>
                </RackFields>
              ) : (
                <button type="button" className={PLAIN} data-testid="rack-add" onClick={() => setNewRack(rackForm())}>
                  <Plus size={16} /> Add a rack
                </button>
              )}
            </div>

            {rack && (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                {editRack ? (
                  <RackFields form={editRack} onChange={setEditRack} sites={sites} siteId={rack.siteId}>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" className={PLAIN} onClick={() => setEditRack(null)}>Cancel</button>
                      <button type="button" className={MAIN} disabled={!editRack.name.trim()} onClick={async () => { if (await saveRack(rack.id, rackDraft(editRack, editRack.siteId ?? rack.siteId))) setEditRack(null); }}>
                        Save rack
                      </button>
                    </div>
                  </RackFields>
                ) : (
                  <>
                    <RackElevation
                      rack={rack}
                      onOpenItem={(item) => showOnMap({ type: 'equipment', data: item })}
                    />
                    <p className="text-[11px] text-slate-500">To put an item in this rack, open the item and use Connectivity, Site and rack.</p>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={PLAIN} onClick={() => setEditRack(rackForm(rack))}>Change rack</button>
                      <button type="button" className={DANGER} onClick={() => void removeRack(rack.id)}>
                        <Trash2 size={15} /> Delete rack
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {looseAtSite.length > 0 && (
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold text-slate-600">At this site, not in a recorded rack</p>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {looseAtSite.map((e) => (
                    <li key={e.id}>
                      <button type="button" className="min-h-12 rounded border border-slate-300 bg-white px-2 text-xs md:min-h-8" onClick={() => showOnMap({ type: 'equipment', data: e })}>
                        {e.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function SiteFields({ form, onChange, children }: { form: SiteForm; onChange: (f: SiteForm) => void; children: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3" data-testid="site-form">
      <Field label="Site name">
        <Input data-testid="site-name" className={BIG} value={form.name} placeholder="Main exchange" onChange={(e) => onChange({ ...form, name: e.target.value })} />
      </Field>
      <Field label="Kind (optional)">
        <Input className={BIG} value={form.kind} placeholder="Exchange, hub room, POP" onChange={(e) => onChange({ ...form, kind: e.target.value })} />
      </Field>
      <Field label="Address (optional)">
        <Input className={BIG} value={form.address} onChange={(e) => onChange({ ...form, address: e.target.value })} />
      </Field>
      <Field label="Notes (optional)">
        <Textarea value={form.notes} onChange={(e) => onChange({ ...form, notes: e.target.value })} />
      </Field>
      {children}
    </div>
  );
}

function RackFields({
  form,
  onChange,
  sites,
  siteId,
  children,
}: {
  form: RackForm;
  onChange: (f: RackForm) => void;
  sites?: readonly Site[];
  siteId?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3" data-testid="rack-form">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Rack name, as labelled">
          <Input data-testid="rack-name" className={BIG} value={form.name} placeholder="Rack 3" onChange={(e) => onChange({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Height in units" hint="Count the holes, or read the label (42U). Empty if not known.">
          <Input data-testid="rack-height" className={BIG} inputMode="numeric" value={form.heightUnits} onChange={(e) => onChange({ ...form, heightUnits: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field label="Unit numbers">
          <Select className={BIG} value={form.numbering} onChange={(e) => onChange({ ...form, numbering: e.target.value as RackNumbering | '' })}>
            <option value="">Not recorded</option>
            {RACK_NUMBERINGS.map((n) => (
              <option key={n} value={n}>
                {RACK_NUMBERING_LABELS[n]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Where in the room (optional)">
          <Input className={BIG} value={form.location} placeholder="Row B, by the door" onChange={(e) => onChange({ ...form, location: e.target.value })} />
        </Field>
        {sites && (
          <Field label="Site">
            <Select className={BIG} value={form.siteId ?? siteId} onChange={(e) => onChange({ ...form, siteId: e.target.value })}>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <Field label="Notes (optional)">
        <Textarea value={form.notes} onChange={(e) => onChange({ ...form, notes: e.target.value })} />
      </Field>
      {children}
    </div>
  );
}
