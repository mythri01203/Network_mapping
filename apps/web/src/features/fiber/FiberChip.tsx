import { CORE_STATUS_LABELS, type CoreIdentity, type CoreStatus } from '@fibergis/shared';

import { cn } from '../../components/ui';
import { STATUS_MARK } from './fiberUi';

/** A fiber's identification colour. Shown only when the cable's scheme is known; never a status colour. */
export function FiberSwatch({ identity, size = 14 }: { identity?: CoreIdentity; size?: number }) {
  const colour = identity?.fiberColor;
  if (!colour) {
    return (
      <span
        aria-label="Colour not known"
        title="Colour not known. Check the drum."
        className="inline-block shrink-0 rounded-full border border-dashed border-slate-400 bg-white"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-label={colour.name}
      title={`${colour.name}${colour.repeatNote ? ` (${colour.repeatNote})` : ''}`}
      className={cn('inline-block shrink-0 rounded-full border border-black/20', colour.repeat > 0 && 'ring-2 ring-offset-1 ring-slate-500')}
      style={{ width: size, height: size, backgroundColor: colour.hex }}
    />
  );
}

/** A tube's colour, kept apart from the fiber colour. */
export function TubeSwatch({ identity }: { identity?: CoreIdentity }) {
  const colour = identity?.tubeColor;
  return (
    <span
      title={colour ? `Tube ${identity?.tubeNumber}: ${colour.name}` : 'Tube colour not known'}
      className={cn('inline-block h-3 w-6 shrink-0 rounded-sm border', colour ? 'border-black/20' : 'border-dashed border-slate-400 bg-white')}
      style={colour ? { backgroundColor: colour.hex } : undefined}
    />
  );
}

const STATUS_STYLE: Partial<Record<CoreStatus, string>> = {
  'In Use': 'bg-blue-50 text-blue-800 border-blue-200',
  Reserved: 'bg-amber-50 text-amber-800 border-amber-200',
  Damaged: 'bg-red-50 text-red-800 border-red-200',
  Spliced: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  Disconnected: 'bg-slate-100 text-slate-700 border-slate-300',
  Faulty: 'bg-red-50 text-red-800 border-red-300',
  Retired: 'bg-slate-200 text-slate-700 border-slate-400 line-through decoration-slate-500',
};

const statusMark = (status: CoreStatus) => STATUS_MARK[status] ?? '·';

/** The core's state as a label with a mark. Separate from its colour, so blue stays blue. */
export function CoreStatusBadge({ status }: { status: CoreStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium',
        STATUS_STYLE[status] ?? 'bg-white text-slate-600 border-slate-200',
      )}
    >
      <span aria-hidden>{statusMark(status)}</span>
      {CORE_STATUS_LABELS[status]}
    </span>
  );
}
