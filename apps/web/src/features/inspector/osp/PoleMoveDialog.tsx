import { useState } from 'react';
import { Move } from 'lucide-react';

import { choicesFromOffers, type MoveOffer } from '@fibergis/shared';

import { Modal } from '../../../components/ui';
import { useOspUiStore } from '../../../stores/ospUiStore';

const KIND_WORDS: Record<MoveOffer['kind'], string> = {
  cable_point: 'Cable line point',
  slack_loop: 'Slack loop',
  duct_end: 'Duct end',
};

/**
 * Phase 4: "What else moves with this pole?" Everything at the old position is listed with nothing
 * ticked. Only what the person ticks moves; "Do not move" leaves the pole and everything else where
 * they were.
 */
export function PoleMoveDialog() {
  const pending = useOspUiStore((s) => s.pendingMove);
  if (!pending) return null;
  // A fresh form per question, so ticks never carry over to another pole.
  return <PoleMoveForm key={`${pending.preview.structure.id}:${pending.to.join(',')}`} />;
}

function PoleMoveForm() {
  const pending = useOspUiStore((s) => s.pendingMove)!;
  const answer = useOspUiStore((s) => s.answerMove);
  const [ticked, setTicked] = useState<Set<string>>(() => new Set());
  const { structure, offers, cableEndIds } = pending.preview;

  const toggle = (key: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <Modal
      open
      onClose={() => answer(null)}
      title={`Move ${structure.name}?`}
      icon={Move}
      size="md"
      closeOnOverlayClick={false}
      footer={
        <div className="grid w-full grid-cols-2 gap-2">
          <button type="button" onClick={() => answer(null)} className="min-h-[52px] rounded-lg border border-slate-300 bg-white px-3 text-[15px] font-semibold text-slate-800 hover:bg-slate-50" data-testid="pole-move-cancel">
            Do not move
          </button>
          <button
            type="button"
            onClick={() => answer(choicesFromOffers(offers, ticked))}
            className="min-h-[52px] rounded-lg bg-blue-600 px-3 text-[15px] font-semibold text-white hover:bg-blue-500"
            data-testid="pole-move-confirm"
          >
            {ticked.size ? `Move it and ${ticked.size} ticked` : `Move ${structure.name} only`}
          </button>
        </div>
      }
    >
      <div className="space-y-3" data-testid="pole-move-dialog">
        <p className="text-[14px] text-slate-700">
          These are at the old place of {structure.name}. Tick each one that should move with it. Anything not ticked stays where it is.
        </p>
        {cableEndIds.length > 0 && (
          <p className="rounded-lg bg-slate-50 p-2 text-[13px] text-slate-600">
            {cableEndIds.length} cable end(s) that start or end at {structure.name} move with it, as always.
          </p>
        )}
        <ul className="space-y-2">
          {offers.map((offer) => (
            <li key={offer.key}>
              <label className="flex min-h-[56px] cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50" data-testid={`pole-move-offer-${offer.key}`}>
                <input type="checkbox" className="mt-0.5 h-6 w-6 shrink-0 accent-blue-600" checked={ticked.has(offer.key)} onChange={() => toggle(offer.key)} />
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold text-slate-900">
                    {KIND_WORDS[offer.kind]}: {offer.label}
                  </span>
                  <span className="block text-[13px] text-slate-600">{offer.detail}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <p className="text-[12px] text-slate-500">You can undo the move afterwards.</p>
      </div>
    </Modal>
  );
}
