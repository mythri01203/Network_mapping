import { useState } from 'react';
import { Camera } from 'lucide-react';

import { photoUrl, randomCode } from '@fibergis/shared';

import { showToast } from '../../stores/toastStore';
import { compressImageFile } from '../capture/photo';

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

const photoSrc = (id: string) => `${API_BASE}${photoUrl(id)}`;

/** Photo thumbnails, each opening the full photo. */
export function PhotoStrip({ ids, alt }: { ids: readonly string[]; alt: string }) {
  if (ids.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {ids.map((id) => (
        <a key={id} href={photoSrc(id)} target="_blank" rel="noreferrer" className="block">
          <img src={photoSrc(id)} alt={alt} className="h-12 w-12 rounded border border-slate-200 object-cover" />
        </a>
      ))}
    </div>
  );
}

/**
 * Photos for a splice or pigtail form: each photo is sent to the office first and only its id is
 * kept on the form. With no connection the photo is not kept, and the screen says so.
 */
export function SplicePhotoPicker({ ids, onChange, testId }: { ids: string[]; onChange: (ids: string[]) => void; testId: string }) {
  const [busy, setBusy] = useState(false);
  const add = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const blob = await compressImageFile(file);
      const id = `SPP-${randomCode(12)}`;
      const response = await fetch(photoSrc(id), { method: 'PUT', headers: { 'content-type': blob.type || 'image/jpeg' }, body: blob });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      onChange([...ids, id]);
    } catch {
      showToast('error', 'Photo not saved', 'The photo could not reach the office. Try again when there is a connection.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-1.5" data-testid={testId}>
      <PhotoStrip ids={ids} alt="Splice photo" />
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex min-h-12 cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 md:min-h-8">
          <Camera size={14} aria-hidden />
          {busy ? 'Sending…' : ids.length ? 'Add another photo' : 'Add photo'}
          <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={busy} onChange={(e) => void add(e.target.files?.[0])} />
        </label>
        {ids.length > 0 && (
          <button type="button" className="min-h-12 px-2 text-xs text-slate-600 underline md:min-h-8" onClick={() => onChange(ids.slice(0, -1))}>
            Remove last photo
          </button>
        )}
        {ids.length === 0 && <span className="text-xs text-slate-500">No photo yet.</span>}
      </div>
    </div>
  );
}
