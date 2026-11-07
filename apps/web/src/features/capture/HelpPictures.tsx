import { Camera, ChevronRight, Lock, MapPin, MousePointerClick } from 'lucide-react';

import { Say } from './ui';

/**
 * Pictures of the browser's own permission prompts, which are often in English whatever language the
 * phone uses. They show what to tap before the prompt appears, and how to undo a "Block".
 */
function PromptPicture({ what }: { what: 'camera' | 'location' }) {
  const Icon = what === 'camera' ? Camera : MapPin;
  return (
    <div className="mx-auto w-full max-w-[18rem] rounded-2xl border-2 border-slate-900 bg-slate-100 p-3" aria-hidden>
      <div className="rounded-xl bg-white p-3 shadow">
        <div className="flex items-center gap-2 text-[0.95rem] font-semibold text-slate-900">
          <Icon className="h-5 w-5" /> {what === 'camera' ? 'Use your camera?' : 'Know your location?'}
        </div>
        <div className="mt-3 flex justify-end gap-2 text-[0.95rem] font-bold">
          <span className="rounded-lg px-3 py-2 text-slate-700">Block</span>
          <span className="relative rounded-lg bg-blue-800 px-4 py-2 text-white ring-4 ring-amber-400">
            Allow
            <MousePointerClick className="absolute -bottom-7 -right-3 h-8 w-8 text-slate-900" />
          </span>
        </div>
      </div>
    </div>
  );
}

function UnblockPicture() {
  return (
    <div className="mx-auto flex w-full max-w-[18rem] flex-col gap-2 rounded-2xl border-2 border-slate-900 bg-slate-100 p-3 text-[0.95rem] font-semibold text-slate-900" aria-hidden>
      <div className="flex items-center gap-2 rounded-full bg-white px-3 py-2">
        <span className="rounded-full p-1 ring-4 ring-amber-400">
          <Lock className="h-5 w-5" />
        </span>
        <span className="truncate text-slate-700">fibergis…</span>
      </div>
      <div className="flex items-center gap-2 pl-2">
        <ChevronRight className="h-5 w-5" /> Permissions
      </div>
      <div className="flex items-center justify-between rounded-lg bg-white px-3 py-2">
        <span>Camera, Location</span>
        <span className="rounded-full bg-blue-800 px-3 py-1 text-white ring-4 ring-amber-400">Allow</span>
      </div>
    </div>
  );
}

export function PermissionHelp({ show }: { show: ('camera' | 'location' | 'denied')[] }) {
  return (
    <div className="flex flex-col gap-5">
      {show.includes('camera') && (
        <section className="flex flex-col gap-3">
          <p className="text-[1.125rem] font-semibold text-slate-900">
            <Say k="help.camera" />
          </p>
          <PromptPicture what="camera" />
        </section>
      )}
      {show.includes('location') && (
        <section className="flex flex-col gap-3">
          <p className="text-[1.125rem] font-semibold text-slate-900">
            <Say k="help.location" />
          </p>
          <PromptPicture what="location" />
        </section>
      )}
      {show.includes('denied') && (
        <section className="flex flex-col gap-3">
          <p className="text-[1.125rem] font-semibold text-slate-900">
            <Say k="help.denied" />
          </p>
          <UnblockPicture />
        </section>
      )}
    </div>
  );
}
