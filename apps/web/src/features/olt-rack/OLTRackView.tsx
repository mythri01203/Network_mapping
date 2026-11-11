import React, { useState } from 'react';
import { GitFork, MapPin, Radio, Server } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { buildOltPonPorts, ponCapacityText, ponPortPlace, ponPortUsage } from '@fibergis/shared';

import { useOpenView } from '../../app/views';
import { useMapStore } from '../../stores/mapStore';
import { traceNetworkPath } from '../../stores/networkActions';
import { useNetworkStore } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';
import { PON_TECHNOLOGY_SPECS } from '../inspector/ponTechnology';
import { SitesRacksView } from './SitesRacksView';
import { type RackScreenTab, takeRequestedTab } from './sitesTab';

/**
 * The OLT Rack screen. Phase 9: two parts, the OLT's PON ports and Sites and racks (site and rack
 * records with a drawing of each rack). Sites and racks opens even when no OLT is on the map yet.
 */
export const OLTRackView: React.FC = () => {
  const [tab, setTab] = useState<RackScreenTab>(() => takeRequestedTab() ?? 'ports');
  const tabs: { id: RackScreenTab; label: string }[] = [
    { id: 'ports', label: 'OLT PON ports' },
    { id: 'sites', label: 'Sites and racks' },
  ];
  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <div role="tablist" aria-label="OLT Rack" className="flex shrink-0 gap-1 border-b border-slate-800 bg-slate-950 px-3" data-testid="olt-rack-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            data-testid={`olt-rack-tab-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`-mb-px min-h-12 border-b-2 px-3 text-[14px] font-semibold md:min-h-10 md:text-[13px] ${tab === t.id ? 'border-blue-400 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'ports' ? <PonPortsPanel /> : <SitesRacksView />}
    </div>
  );
};

/** The OLT's own PON ports as recorded. Nothing here is generated: blanks say "Not recorded". */
const PonPortsPanel: React.FC = () => {
  const { equipments, cables, customers, splitters, onts, services } = useNetworkStore(
    useShallow((s) => ({ equipments: s.equipment, cables: s.cables, customers: s.customers, splitters: s.splitters, onts: s.onts, services: s.services })),
  );
  const flyToLocation = useMapStore((s) => s.flyTo);
  const setModalOpen = useUiStore((s) => s.setModalOpen);
  const openView = useOpenView();

  const olts = equipments.filter((e) => e.type === 'OLT');
  const [selectedOltId, setSelectedOltId] = useState<string>(olts[0]?.id ?? '');
  const [selectedPonPort, setSelectedPonPort] = useState<number | null>(1);

  const currentOlt = olts.find((e) => e.id === selectedOltId) ?? olts[0];

  if (!currentOlt) {
    return (
      <div className="flex flex-1 items-center justify-center bg-slate-900 p-6 text-center text-slate-300">
        <div className="max-w-sm space-y-2">
          <Server className="mx-auto h-8 w-8 text-slate-500" />
          <h2 className="text-sm font-bold text-white">No OLT on the map yet</h2>
          <p className="text-xs">Place an OLT on the map. Its PON ports will show here.</p>
        </div>
      </div>
    );
  }

  // Phase 10: counts come from the customer, ONT and service records (disconnected customers are not counted).
  const usageData = { equipment: [{ ...currentOlt, ponPorts: buildOltPonPorts(currentOlt) }], customers, onts, services };
  const ponPorts = buildOltPonPorts(currentOlt).map((pon) => {
    const feeder = pon.connectedFeederCableId ? cables.find((c) => c.id === pon.connectedFeederCableId) : undefined;
    const splitter = pon.connectedSplitterId ? splitters.find((s) => s.id === pon.connectedSplitterId) : undefined;
    const usage = ponPortUsage(usageData, currentOlt.id, pon.id);
    const subscribers = usage?.customers.length ?? 0;
    return { pon, feeder, splitter, subscribers, usage, place: ponPortPlace(currentOlt, pon.id) };
  });
  const selected = ponPorts.find((p) => p.pon.portNumber === selectedPonPort) ?? ponPorts[0];
  const technology = selected?.pon.technology ?? currentOlt.technology;
  const spec = technology ? PON_TECHNOLOGY_SPECS[technology] : undefined;
  const readingLabel = currentOlt.isSampleData ? 'Sample data' : 'Saved reading';

  const handleLocateOnMap = () => {
    openView('map');
    setTimeout(() => flyToLocation(currentOlt.lat, currentOlt.lng, 18), 100);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-900 text-slate-100 overflow-hidden select-none">
      <div className="min-h-14 bg-slate-950 border-b border-slate-800 px-6 py-2 flex flex-wrap items-center justify-between gap-3 shrink-0 shadow-md z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
            <Server className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white tracking-wide">OLT PON Ports</h2>
            <p className="text-[11px] text-slate-400">
              {[currentOlt.manufacturer, currentOlt.model].filter(Boolean).join(' ') || 'Make and model not recorded'} · No
              live connection
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs">
            <span className="text-slate-400">OLT:</span>
            <select
              value={currentOlt.id}
              onChange={(e) => setSelectedOltId(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-1.5 text-xs font-semibold outline-none focus:border-blue-500"
            >
              {olts.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.id})
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={handleLocateOnMap}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold transition-all shadow-xs"
          >
            <MapPin className="w-3.5 h-3.5" />
            <span>Locate on Map</span>
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden md:flex-row">
        <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-start bg-slate-900/90">
          <div className="w-full max-w-4xl bg-slate-950 border-4 border-slate-700 rounded-2xl p-6 shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-4 mb-4 border-b border-slate-800">
              <span className="font-mono text-xs font-bold text-slate-300 tracking-wider">
                {currentOlt.name} · {technology ?? 'Technology not recorded'}
              </span>
              <span className="text-[10px] text-slate-400 font-mono bg-slate-900 px-2 py-0.5 rounded border border-slate-700">
                No live connection: power, temperature and alarms are not monitored
              </span>
            </div>

            {ponPorts.length === 0 ? (
              <p className="text-xs text-slate-400">No PON ports configured. Open Configure OLT to set the port count.</p>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-2.5">
                {ponPorts.map(({ pon, subscribers }) => {
                  const isSelected = selected?.pon.portNumber === pon.portNumber;
                  return (
                    <button
                      key={pon.id}
                      type="button"
                      onClick={() => setSelectedPonPort(pon.portNumber)}
                      className={`flex flex-col items-center justify-between p-2 rounded-lg border transition-all ${
                        isSelected
                          ? 'bg-blue-600/30 border-blue-400 ring-2 ring-blue-500/50'
                          : pon.status === 'Faulty'
                            ? 'bg-rose-950/40 border-rose-600/60 hover:border-rose-500'
                            : 'bg-slate-950 border-slate-800 hover:border-slate-600'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full mb-1">
                        <span className="text-[10px] font-mono font-bold text-slate-300">#{pon.portNumber}</span>
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            pon.status === 'Faulty' ? 'bg-rose-500' : pon.status === 'Active' ? 'bg-emerald-400' : 'bg-slate-600'
                          }`}
                        />
                      </div>
                      <div className="w-7 h-4 bg-slate-800 border border-slate-600 rounded-xs flex items-center justify-center my-1">
                        <div className="w-4 h-2 bg-slate-950 rounded-xs border border-slate-700" />
                      </div>
                      <span className="text-[9px] font-mono text-slate-400 mt-1">{pon.status}</span>
                      <span className="text-[9px] text-blue-300 font-semibold">{subscribers} Subs</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {selected && (
          <aside className="w-full md:w-88 bg-slate-950 border-t md:border-t-0 md:border-l border-slate-800 p-5 flex flex-col justify-between overflow-y-auto shrink-0 shadow-2xl">
            <div>
              <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-blue-600/30 border border-blue-500/50 flex items-center justify-center text-blue-400 font-bold text-xs">
                    {selected.pon.portNumber}
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-white">{selected.pon.slotCardPort || selected.pon.id}</h3>
                    <p className="text-[11px] text-slate-400">{currentOlt.name}</p>
                  </div>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-slate-900 text-slate-300 border-slate-700">
                  {selected.pon.status}
                </span>
              </div>

              <div className="space-y-3.5 text-xs">
                <div className="bg-slate-900 p-3 rounded-xl border border-slate-800 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Optical Tx Power:</span>
                    <span className="font-mono font-bold text-emerald-400">
                      {selected.pon.txPowerDbm !== undefined
                        ? `${selected.pon.txPowerDbm} dBm (${readingLabel})`
                        : 'Not recorded'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Wavelengths:</span>
                    <span className="font-mono text-slate-200">{spec?.wavelengths ?? 'Not recorded'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Optics class:</span>
                    <span className="font-mono text-slate-200">{selected.pon.opticsClass ?? 'Not recorded'}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-400">On card:</span>
                    <span className="text-right font-mono text-slate-200">{selected.place?.text ?? 'Not recorded'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Splitter:</span>
                    <span className="font-mono text-slate-200">
                      {selected.splitter ? `${selected.splitter.name} (${selected.splitter.ratio})` : 'Not recorded'}
                    </span>
                  </div>
                </div>

                <div className="bg-slate-900 p-3 rounded-xl border border-slate-800">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Outgoing Feeder</span>
                  <div className="mt-1.5">
                    <div className="font-bold text-white text-xs">
                      {selected.feeder?.name ??
                        (selected.pon.connectedFeederCableId
                          ? `${selected.pon.connectedFeederCableId} (no longer on the map)`
                          : 'Not recorded')}
                    </div>
                    {selected.feeder && <div className="text-[10px] font-mono text-blue-400">{selected.feeder.id}</div>}
                  </div>
                </div>

                <div className="bg-slate-900 p-3 rounded-xl border border-slate-800 space-y-2" data-testid="olt-rack-usage">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Customers on this port:</span>
                    <span className="font-bold text-white">{selected.subscribers}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">ONTs:</span>
                    <span className="font-bold text-white">{selected.usage?.ontCount ?? 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Services running:</span>
                    <span className="font-bold text-white">{selected.usage?.services.length ?? 0}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-400">Capacity:</span>
                    <span className={`text-right font-bold ${selected.usage?.overLimit ? 'text-rose-400' : 'text-white'}`}>
                      {selected.usage ? ponCapacityText(selected.usage) : 'Not recorded'}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500">Counted from the customer, ONT and service records.</p>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-800 pt-4 mt-4 space-y-2">
              <button
                type="button"
                onClick={() => traceNetworkPath(`${currentOlt.id}/${selected.pon.id}`)}
                className="w-full py-2.5 px-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 shadow-md transition-all"
              >
                <GitFork className="w-3.5 h-3.5" />
                <span>Trace Fiber Path From This Port</span>
              </button>
              <button
                type="button"
                onClick={() => setModalOpen('cableWizard', true)}
                className="w-full py-2 px-3 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all"
              >
                <Radio className="w-3.5 h-3.5 text-blue-400" />
                <span>Map New Feeder Cable from OLT</span>
              </button>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
};
