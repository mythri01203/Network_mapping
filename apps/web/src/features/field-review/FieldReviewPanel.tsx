import { useMemo, useState } from 'react';
import { CheckCircle2, ClipboardCheck, Copy, MapPin, MapPinOff, RotateCcw, Tag, XCircle } from 'lucide-react';

import {
  acceptFieldCapture,
  type Equipment,
  fieldReviewQueue,
  photoUrl,
  rejectedCaptures,
  rejectFieldCapture,
  reopenFieldCapture,
  resolveFieldSettings,
  type ReviewItem,
  roleCan,
} from '@fibergis/shared';

import { useShowOnMap } from '../../app/views';
import { currentAccount, loginIsOn, useAuthStore } from '../../stores/authStore';
import { useNetworkStore } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

/** Reasons the office often gives. The person can always write their own. */
const QUICK_REASONS = ['Same as an item already on the map', 'The photo does not show it', 'Not our network', 'Captured by mistake'];

const BTN = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold disabled:opacity-50';

/** Who decides, as this app knows them. The server's audit entry records the real account. */
const decider = () => currentAccount()?.displayName ?? `${useUiStore.getState().userRole} (local session)`;

/** Accept and reject are office work: not for technicians, look-only, NOC or supervisor accounts. */
function useMayReview(): boolean {
  return useAuthStore((s) => {
    if (!loginIsOn(s)) return true;
    const account = currentAccount(s);
    return !!account && account.role !== 'technician' && roleCan(account.role, 'update', 'equipment');
  });
}

function Photo({ photoId, name }: { photoId?: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (!photoId || failed) {
    return (
      <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-slate-100 p-1 text-center text-[10px] text-slate-500">
        {photoId ? 'Photo not at the office yet' : 'No photo'}
      </span>
    );
  }
  return (
    <a href={`${API_BASE}${photoUrl(photoId)}`} target="_blank" rel="noreferrer" className="shrink-0">
      <img src={`${API_BASE}${photoUrl(photoId)}`} alt={`Field photo of ${name}`} onError={() => setFailed(true)} className="h-20 w-20 rounded-lg border border-slate-200 object-cover" loading="lazy" />
    </a>
  );
}

const positionText = (item: ReviewItem) => {
  if (item.unplaced) return 'No GPS fix: the office must place it on the map.';
  if (item.accuracyMeters === undefined) return 'GPS accuracy not recorded.';
  return `GPS within about ${Math.round(item.accuracyMeters)} m.`;
};

const answersOf = (e: Equipment) =>
  [
    e.ownerType ? `owner seen: ${e.ownerType}` : null,
    e.material ? `material: ${e.material}` : null,
    e.customerId ? `customer said: ${e.customerId}` : null,
  ].filter(Boolean) as string[];

function ReviewCard({ item, mayReview }: { item: ReviewItem; mayReview: boolean }) {
  const showOnMap = useShowOnMap();
  const equipment = useNetworkStore((s) => s.equipment);
  const [mode, setMode] = useState<'none' | 'reject' | 'acceptUnplaced'>('none');
  const [reason, setReason] = useState('');
  const e = item.equipment;

  const accept = () => {
    if (item.unplaced && mode !== 'acceptUnplaced') {
      setMode('acceptUnplaced');
      return;
    }
    const ok = useNetworkStore.getState().runCommand((data) => acceptFieldCapture(data, e.id, { by: decider(), reason: item.unplaced ? reason : undefined }));
    if (ok) setMode('none');
  };
  const reject = () => {
    const ok = useNetworkStore.getState().runCommand((data) => rejectFieldCapture(data, e.id, { by: decider(), reason }));
    if (ok) setMode('none');
  };
  const open = (target: Equipment) => {
    const fresh = equipment.find((x) => x.id === target.id) ?? target;
    showOnMap({ type: 'equipment', data: fresh }, 19);
  };

  return (
    <li className="space-y-2 p-3" data-testid="review-item" data-id={e.id}>
      <div className="flex flex-wrap items-start gap-3">
        <Photo photoId={item.photoId} name={e.name} />
        <div className="min-w-0 flex-1 space-y-0.5 text-xs">
          <div className="font-bold text-slate-900">
            {e.name} <span className="font-normal text-slate-500">· {e.type} · {e.id}</span>
          </div>
          <div className="text-slate-600">
            Captured {item.capturedAt ? item.capturedAt.slice(0, 16).replace('T', ' ') : '(time not recorded)'}
            {item.capturedBy ? ` by ${item.capturedBy}` : ''}
          </div>
          <div className={`flex items-center gap-1 ${item.unplaced ? 'text-red-700' : 'text-slate-700'}`}>
            {item.unplaced ? <MapPinOff className="h-3.5 w-3.5" /> : <MapPin className="h-3.5 w-3.5" />}
            {positionText(item)}
          </div>
          <div className="flex items-center gap-1 text-slate-700">
            <Tag className="h-3.5 w-3.5" /> {e.tagCode ? `Tag ${e.tagCode}` : 'No tag scanned'}
          </div>
          {answersOf(e).length > 0 && <div className="text-slate-600">As answered on the phone: {answersOf(e).join(', ')}</div>}
        </div>
      </div>

      {item.hints.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950" data-testid="review-hints">
          <div className="flex items-center gap-1 font-semibold">
            <Copy className="h-3.5 w-3.5" /> Maybe the same one as:
          </div>
          <ul className="mt-1 space-y-1">
            {item.hints.map((h) => (
              <li key={`${h.why}-${h.equipment.id}`} className="flex flex-wrap items-center gap-2">
                <span>
                  {h.equipment.name} ({h.equipment.type}
                  {h.equipment.reviewStatus === 'awaiting_review' ? ', also waiting for review' : ''})
                  {h.why === 'near' ? `, ${Math.round(h.distanceMeters ?? 0)} m away` : ', same tag'}
                </span>
                <button type="button" onClick={() => open(h.equipment)} className="font-semibold text-blue-700 underline">
                  Show
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-amber-900">Only a hint, from the phone&apos;s &quot;same one?&quot; distance. Compare the photos before deciding.</p>
        </div>
      ) : (
        <p className="text-[11px] text-slate-500">No item of the same kind recorded nearby, and no other item with this tag.</p>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => open(e)} className={`${BTN} bg-blue-600 text-white hover:bg-blue-500`}>
          <MapPin className="h-3.5 w-3.5" /> Show on map
        </button>
        {mayReview && (
          <>
            <button type="button" onClick={accept} className={`${BTN} bg-emerald-700 text-white hover:bg-emerald-600`} data-testid="review-accept">
              <CheckCircle2 className="h-3.5 w-3.5" /> Accept
            </button>
            <button type="button" onClick={() => setMode(mode === 'reject' ? 'none' : 'reject')} className={`${BTN} border border-red-300 bg-white text-red-700 hover:bg-red-50`} data-testid="review-reject">
              <XCircle className="h-3.5 w-3.5" /> Reject
            </button>
          </>
        )}
      </div>

      {mode !== 'none' && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2" data-testid="review-reason">
          <label className="block text-xs font-semibold text-slate-800">
            {mode === 'reject' ? 'Why is it rejected? The field team sees this in the record.' : 'It has no confirmed position. Why accept it now? (Or place it first with Show on map, then Move this item.)'}
            <textarea
              value={reason}
              maxLength={300}
              onChange={(ev) => setReason(ev.target.value)}
              className="mt-1 block min-h-[60px] w-full rounded-lg border border-slate-300 bg-white p-2 text-xs font-normal"
              data-testid="review-reason-text"
            />
          </label>
          {mode === 'reject' && (
            <div className="flex flex-wrap gap-1.5">
              {QUICK_REASONS.map((r) => (
                <button key={r} type="button" onClick={() => setReason(r)} className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11px] text-slate-700 hover:bg-slate-100">
                  {r}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={mode === 'reject' ? reject : accept}
              disabled={reason.trim().length < 3}
              className={`${BTN} ${mode === 'reject' ? 'bg-red-700' : 'bg-emerald-700'} text-white`}
              data-testid="review-confirm"
            >
              {mode === 'reject' ? 'Reject with this reason' : 'Accept without a position'}
            </button>
            <button type="button" onClick={() => setMode('none')} className={`${BTN} border border-slate-300 bg-white text-slate-700`}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * Phase 19: the office review queue. Poles, boxes and drops captured on the phone wait here, drawn
 * on the map with a dashed violet ring, until the office accepts them (they become normal records)
 * or rejects them with a reason (kept on record, off the map and out of the network).
 */
export function FieldReviewPanel() {
  const equipment = useNetworkStore((s) => s.equipment);
  const settings = useNetworkStore((s) => s.settings);
  const mayReview = useMayReview();
  const field = useMemo(() => resolveFieldSettings(settings), [settings]);
  const queue = useMemo(() => fieldReviewQueue({ equipment }, field), [equipment, field]);
  const rejected = useMemo(() => rejectedCaptures({ equipment }), [equipment]);
  const [showRejected, setShowRejected] = useState(false);

  return (
    <div className="mx-auto max-w-5xl space-y-3" data-testid="field-review">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <ClipboardCheck className="h-4 w-4" /> Waiting for office review{queue.length > 0 ? ` (${queue.length})` : ''}
        </h3>
        <p className="text-xs text-slate-600">
          New poles, boxes and drops from the phone. They are not part of the network until accepted. Accept makes one a normal
          record; Reject keeps it on record, with your reason, but off the map. Danger reports and light readings do not wait here.
        </p>
        {!mayReview && <p className="mt-1 text-xs font-semibold text-slate-700">Your account can look at the queue. The office or an engineer accepts or rejects.</p>}
      </div>
      {queue.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-600" data-testid="review-empty">
          Nothing waiting for review.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {queue.map((item) => (
            <ReviewCard key={item.equipment.id} item={item} mayReview={mayReview} />
          ))}
        </ul>
      )}

      <div>
        <button type="button" onClick={() => setShowRejected((v) => !v)} className="text-xs font-semibold text-slate-700 underline" data-testid="review-show-rejected">
          {showRejected ? 'Hide' : 'Show'} rejected captures ({rejected.length})
        </button>
      </div>
      {showRejected && (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white" data-testid="review-rejected">
          {rejected.length === 0 && <li className="p-3 text-xs text-slate-600">None.</li>}
          {rejected.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-3 p-3 text-xs" data-testid="review-rejected-item">
              <div className="min-w-0 flex-1">
                <div className="font-bold text-slate-900">
                  {e.name} <span className="font-normal text-slate-500">· {e.type} · {e.id}</span>
                </div>
                <div className="text-slate-700">Reason: {e.reviewReason ?? 'Not recorded'}</div>
                <div className="text-slate-500">
                  Rejected {e.reviewedAt ? e.reviewedAt.slice(0, 16).replace('T', ' ') : '(time not recorded)'} by {e.reviewedBy ?? 'not recorded'}
                </div>
              </div>
              {mayReview && (
                <button
                  type="button"
                  onClick={() => useNetworkStore.getState().runCommand((data) => reopenFieldCapture(data, e.id, { by: decider() }))}
                  className={`${BTN} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Put back in the queue
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
