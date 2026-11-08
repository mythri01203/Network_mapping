import { useState } from 'react';
import { Camera } from 'lucide-react';

import { type JointClosure, photoUrl, randomCode } from '@fibergis/shared';

import { saveClosure } from '../../stores/fiberActions';
import { showToast } from '../../stores/toastStore';
import { compressImageFile } from '../capture/photo';

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

/**
 * Photos of a closure (inside, trays, seal). Sent straight to the office: with no connection the
 * photo is not saved, and the screen says so, rather than pretending it was.
 */
export function ClosurePhotos({ closure }: { closure: JointClosure }) {
  const [busy, setBusy] = useState(false);
  const ids = closure.photoIds ?? [];

  const add = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const blob = await compressImageFile(file);
      const id = `CLP-${randomCode(12)}`;
      const response = await fetch(`${API_BASE}${photoUrl(id)}`, { method: 'PUT', headers: { 'content-type': blob.type || 'image/jpeg' }, body: blob });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await saveClosure(closure.id, { photoIds: [...ids, id] });
    } catch {
      showToast('error', 'Photo not saved', 'The photo could not reach the office. Try again when there is a connection.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5" data-testid="closure-photos">
      <p className="text-xs font-semibold text-slate-600">Photos</p>
      <div className="flex flex-wrap gap-1.5">
        {ids.map((id) => (
          <a key={id} href={`${API_BASE}${photoUrl(id)}`} target="_blank" rel="noreferrer">
            <img src={`${API_BASE}${photoUrl(id)}`} alt="Closure photo" className="h-14 w-14 rounded border border-slate-200 object-cover" />
          </a>
        ))}
        {ids.length === 0 && <span className="text-xs text-slate-500">No photos yet.</span>}
      </div>
      <label className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
        <Camera size={14} />
        {busy ? 'Sending…' : 'Add photo'}
        <input type="file" accept="image/*" capture="environment" className="sr-only" data-testid="closure-photo-input" disabled={busy} onChange={(e) => void add(e.target.files?.[0])} />
      </label>
    </div>
  );
}
