import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

import { type Lang3D, type Msg3DKey, t3d } from '../i18n';
import { type GMap, type GMarker, type GPanorama, headingBetween, type LatLng, loadGoogleMaps } from './googleMaps';
import { panelClass, type Tone } from './style';

/**
 * Real street photos (Google Street View) of the place being looked at in 3D, with a Google
 * satellite map under it, and the mapped boxes, poles and houses nearby marked on both. The
 * photos are Google's and were taken on the date Google shows; the markers are this app's
 * records at their recorded positions.
 */

export interface StreetMarker extends LatLng {
  /** One or two letters on the pin. */
  letter: string;
  title: string;
  color: string;
}

type State = 'loading' | 'ready' | 'none' | 'no-key' | 'auth' | 'load';

export function StreetViewPanel({
  tone,
  lang,
  at,
  markers,
  onClose,
}: {
  tone: Tone;
  lang: Lang3D;
  /** The place to show: the selected record, or what the 3D camera looks at. */
  at: LatLng;
  markers: StreetMarker[];
  onClose: () => void;
}) {
  const panoEl = useRef<HTMLDivElement>(null);
  const mapEl = useRef<HTMLDivElement>(null);
  const pano = useRef<GPanorama | null>(null);
  const map = useRef<GMap | null>(null);
  const pins = useRef<GMarker[]>([]);
  const [state, setState] = useState<State>('loading');
  const [date, setDate] = useState('');

  useEffect(() => {
    let live = true;
    loadGoogleMaps()
      .then(async (g) => {
        if (!live || !panoEl.current || !mapEl.current) return;
        if (!map.current) {
          map.current = new g.Map(mapEl.current, {
            center: at,
            zoom: 19,
            mapTypeId: 'hybrid',
            streetViewControl: true,
            fullscreenControl: false,
            mapTypeControl: true,
          });
          pano.current = new g.StreetViewPanorama(panoEl.current, {
            addressControl: true,
            fullscreenControl: false,
            motionTracking: false,
            visible: false,
          });
          map.current.setStreetView(pano.current);
        }
        map.current.setCenter(at);
        for (const p of pins.current) p.setMap(null);
        pins.current = [];
        for (const m of markers) {
          const options = {
            position: { lat: m.lat, lng: m.lng },
            title: m.title,
            label: { text: m.letter, color: '#ffffff', fontSize: '11px', fontWeight: '700' },
            icon: {
              path: 0, // google.maps.SymbolPath.CIRCLE
              scale: 11,
              fillColor: m.color,
              fillOpacity: 1,
              strokeColor: '#ffffff',
              strokeWeight: 2,
            },
          };
          pins.current.push(new g.Marker({ ...options, map: map.current }));
          if (pano.current) pins.current.push(new g.Marker({ ...options, map: pano.current }));
        }
        try {
          // The nearest photo taken outdoors within 300 m.
          const found = await new g.StreetViewService().getPanorama({
            location: at,
            radius: 300,
            preference: 'nearest',
          });
          if (!live || !pano.current) return;
          const loc = found.data.location;
          if (!loc?.pano) throw new Error('none');
          pano.current.setPano(loc.pano);
          const from = loc.latLng ? { lat: loc.latLng.lat(), lng: loc.latLng.lng() } : at;
          // Face the place that was asked for.
          pano.current.setPov({ heading: headingBetween(from, at), pitch: 5 });
          pano.current.setVisible(true);
          setDate(found.data.imageDate ?? '');
          setState('ready');
        } catch {
          if (!live) return;
          pano.current?.setVisible(false);
          setState('none');
        }
      })
      .catch((e: Error) => {
        if (live) setState(e.message === 'no-key' ? 'no-key' : e.message === 'auth' ? 'auth' : 'load');
      });
    return () => {
      live = false;
    };
  }, [at, markers]);

  useEffect(
    () => () => {
      for (const p of pins.current) p.setMap(null);
      pins.current = [];
    },
    [],
  );

  const muted = tone.dark ? 'text-slate-400' : 'text-slate-500';
  const message = state === 'ready' ? '' : t3d(lang, `sv.${state}` as Msg3DKey);
  return (
    <section
      aria-label={t3d(lang, 'sv.title')}
      className={`absolute inset-x-2 bottom-2 top-2 z-20 flex flex-col overflow-hidden md:left-auto md:w-[min(56%,820px)] ${panelClass(tone)}`}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 px-3 py-1.5">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold">{t3d(lang, 'sv.title')}</div>
          <div className={`truncate text-[11.5px] ${muted}`}>
            {state === 'ready' ? t3d(lang, 'sv.note', { date: date || '?' }) : message}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t3d(lang, 'close')}
          className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full hover:bg-black/10"
        >
          <X size={18} />
        </button>
      </header>
      <div className="relative min-h-0 flex-[3] bg-slate-800">
        <div ref={panoEl} className="absolute inset-0" />
        {state !== 'ready' && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-[13px] text-slate-100">
            {message}
          </div>
        )}
      </div>
      <div ref={mapEl} className="min-h-0 flex-[2] border-t border-black/20 bg-slate-200" />
    </section>
  );
}
