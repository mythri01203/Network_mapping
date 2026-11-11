import { ClipboardCheck } from 'lucide-react';

import { type Equipment, FIELD_REVIEW_STATUS_LABELS, inspectionTargetOf } from '@fibergis/shared';

import { useOpenView } from '../../app/views';
import { InspectionsSection } from '../inspector/osp/InspectionSection';

/**
 * Phase 19: on a phone capture's panel, where it stands with the office. A capture waiting for
 * review is not yet part of the network; a rejected one is kept with its reason.
 */
export function FieldReviewBanner({ equipment }: { equipment: Equipment }) {
  const openView = useOpenView();
  const status = equipment.reviewStatus;
  if (!status || status === 'accepted') {
    if (status !== 'accepted') return null;
    return (
      <p className="mx-4 mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-[12px] text-emerald-900" data-testid="review-banner" data-status={status}>
        Phone capture accepted by {equipment.reviewedBy ?? 'not recorded'}
        {equipment.reviewedAt ? ` on ${equipment.reviewedAt.slice(0, 10)}` : ''}.
        {equipment.reviewReason ? ` Accepted without a placed position: ${equipment.reviewReason}` : ''}
      </p>
    );
  }
  const waiting = status === 'awaiting_review';
  return (
    <div
      className={`mx-4 mt-3 space-y-1 rounded-lg border px-3 py-2 text-[12px] ${waiting ? 'border-violet-300 bg-violet-50 text-violet-950' : 'border-red-200 bg-red-50 text-red-900'}`}
      data-testid="review-banner"
      data-status={status}
    >
      <div className="flex items-center gap-1.5 font-semibold">
        <ClipboardCheck size={14} /> {FIELD_REVIEW_STATUS_LABELS[status]}
      </div>
      {waiting ? (
        <p>Captured on the phone. It is not part of the network until the office accepts it.</p>
      ) : (
        <p>
          Reason: {equipment.reviewReason ?? 'Not recorded'}. By {equipment.reviewedBy ?? 'not recorded'}
          {equipment.reviewedAt ? `, ${equipment.reviewedAt.slice(0, 16).replace('T', ' ')}` : ''}.
        </p>
      )}
      <button type="button" onClick={() => openView('operations')} className="min-h-[44px] font-semibold underline md:min-h-0">
        Open the review queue (Operations, Field captures)
      </button>
    </div>
  );
}

/** Phase 19: boxes and closures (FAT, FDT, joint closures) have inspections with their own checklist. */
export function BoxInspections({ equipment }: { equipment: Equipment }) {
  if (inspectionTargetOf(equipment) !== 'box') return null;
  return <InspectionsSection targetType="box" targetId={equipment.id} name={equipment.name} />;
}
