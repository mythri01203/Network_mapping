import { useMemo } from 'react';
import { CheckCircle2, MapPin, MapPinOff, Waypoints, X } from 'lucide-react';

import { confirmFieldLocation, fieldFollowUps, type FollowUpItem, photoUrl, resolveFieldSettings, type Span } from '@fibergis/shared';

import { useShowOnMap } from '../../app/views';
import { useMapStore } from '../../stores/mapStore';
import { useNetworkStore } from '../../stores/networkStore';
import { deleteSpan, setSpanStatus } from '../../stores/ospActions';
import { useUiStore } from '../../stores/uiStore';

const reasonText = (item: FollowUpItem) =>
  item.reason === 'office_must_place'
    ? 'No GPS fix. The office must place this on the map.'
    : `Rough position${item.accuracyMeters !== undefined ? `, within about ${Math.round(item.accuracyMeters)} m` : ', accuracy not recorded'}. Check it against the photo.`;

/**
 * Field captures the office must place or check: no GPS fix, or worse than the accept limit. Placing
 * one is a desktop task: "Show on map" opens it, then "Move this item" in its panel places it.
 */
export function FieldFollowUpPanel() {
  const equipment = useNetworkStore((s) => s.equipment);
  const faults = useNetworkStore((s) => s.faults);
  const settings = useNetworkStore((s) => s.settings);
  const role = useUiStore((s) => s.userRole);
  const showOnMap = useShowOnMap();
  const limits = useMemo(() => resolveFieldSettings(settings).gps, [settings]);
  const items = useMemo(() => fieldFollowUps({ equipment, faults }, limits), [equipment, faults, limits]);

  const open = (item: FollowUpItem) => {
    if (item.collection === 'equipment') {
      const record = equipment.find((e) => e.id === item.id);
      if (record) showOnMap({ type: 'equipment', data: record }, 19);
    } else {
      const record = faults.find((f) => f.id === item.id);
      if (record) showOnMap({ type: 'fault', data: record }, 19);
    }
  };

  const confirm = (item: FollowUpItem) =>
    useNetworkStore.getState().runCommand((data) => confirmFieldLocation(data, item.collection, item.id, `${role} User`));

  const spans = useNetworkStore((s) => s.spans);
  const proposed = useMemo(() => spans.filter((s) => s.status === 'proposed'), [spans]);
  const nameOf = (id: string) => equipment.find((e) => e.id === id)?.name ?? `${id} (missing)`;
  const openSpan = (span: Span) => {
    const from = equipment.find((e) => e.id === span.fromStructureId);
    showOnMap({ type: 'span', data: span });
    if (from) useMapStore.getState().flyTo(from.lat, from.lng, 19);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-3" data-testid="field-follow-up">
      <div>
        <h3 className="text-sm font-bold text-slate-800">Field captures to place or check</h3>
        <p className="text-xs text-slate-600">
          From the phone capture flow. Items with no GPS fix sit at a placeholder point until placed. The GPS accept limit is{' '}
          {limits.acceptMeters} m (Administration, Field capture settings).
        </p>
      </div>
      {items.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-600">Nothing to place or check.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {items.map((item) => (
            <li key={`${item.collection}-${item.id}`} className="flex flex-wrap items-center gap-3 p-3" data-testid="follow-up-item">
              {item.photoId ? (
                <img src={photoUrl(item.photoId)} alt={`Field photo of ${item.name}`} className="h-14 w-14 rounded-lg border border-slate-200 object-cover" loading="lazy" />
              ) : (
                <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-slate-100 text-[10px] text-slate-500">No photo</span>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-slate-900">
                  {item.name} <span className="font-normal text-slate-500">· {item.type}</span>
                </div>
                <div className={`flex items-center gap-1 text-xs ${item.reason === 'office_must_place' ? 'text-red-700' : 'text-amber-800'}`}>
                  {item.reason === 'office_must_place' ? <MapPinOff className="h-3.5 w-3.5" /> : <MapPin className="h-3.5 w-3.5" />}
                  {reasonText(item)}
                </div>
                {item.capturedAt && <div className="text-[11px] text-slate-500">GPS reading {item.capturedAt.slice(0, 16).replace('T', ' ')}</div>}
              </div>
              <button type="button" onClick={() => open(item)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500">
                Show on map
              </button>
              {item.reason === 'rough_location' && (
                <button
                  type="button"
                  onClick={() => confirm(item)}
                  className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Position is right
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="pt-2">
        <h3 className="text-sm font-bold text-slate-800">Spans to confirm</h3>
        <p className="text-xs text-slate-600">
          When a worker uses "Next pole", the two poles are joined by a proposed span, drawn dashed. That records the order of the
          walk, not a cable. Confirm each one, or remove it.
        </p>
      </div>
      {proposed.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-600" data-testid="proposed-spans-empty">
          No proposed spans.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white" data-testid="proposed-spans">
          {proposed.map((span) => (
            <li key={span.id} className="flex flex-wrap items-center gap-3 p-3" data-testid="proposed-span">
              <Waypoints className="h-5 w-5 text-orange-800" />
              <div className="min-w-0 flex-1 text-xs">
                <div className="font-bold text-slate-900">
                  {nameOf(span.fromStructureId)} – {nameOf(span.toStructureId)}
                </div>
                <div className="text-slate-500">Captured one after the other{span.createdBy ? ` by ${span.createdBy}` : ''}</div>
              </div>
              <button type="button" onClick={() => openSpan(span)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500">
                Show on map
              </button>
              <button
                type="button"
                onClick={() => setSpanStatus(span.id, 'built')}
                className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Yes, built
              </button>
              <button
                type="button"
                onClick={() => void deleteSpan(span.id)}
                className="flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
              >
                <X className="h-3.5 w-3.5" /> Not a span
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
