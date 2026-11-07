import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { WifiOff } from 'lucide-react';

import { useT } from '../../i18n/useT';
import { useMapStore } from '../../stores/mapStore';
import { TILE_PROVIDERS } from '../map/leaflet/tileProviders';

/**
 * A small fixed map with one pin, for the summary card. Map pictures come from the internet and are
 * not stored for offline use, so offline (or when tiles fail) it says so plainly instead.
 */
export function MiniMap({ lat, lng, approximate }: { lat: number; lng: number; approximate?: boolean }) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement | null>(null);
  const provider = useMapStore((s) => s.tileProvider);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [tilesFailed, setTilesFailed] = useState(false);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  useEffect(() => {
    if (!online || !ref.current) return undefined;
    setTilesFailed(false);
    const config = TILE_PROVIDERS[provider] ?? TILE_PROVIDERS.osm;
    const map = L.map(ref.current, {
      zoomControl: false,
      attributionControl: true,
      dragging: false,
      touchZoom: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
    }).setView([lat, lng], approximate ? 15 : 18);
    // Keep the tile credit, drop Leaflet's own tiny link: nothing on this card should invite a tap.
    map.attributionControl.setPrefix(false);
    let errors = 0;
    L.tileLayer(config.url, { maxZoom: config.maxZoom, subdomains: config.subdomains ?? 'abc', attribution: config.attribution })
      .on('tileerror', () => {
        errors += 1;
        if (errors >= 3) setTilesFailed(true);
      })
      .addTo(map);
    L.circleMarker([lat, lng], { radius: 10, color: '#0f172a', weight: 3, fillColor: approximate ? '#f59e0b' : '#1e40af', fillOpacity: 1 }).addTo(map);
    return () => {
      map.remove();
    };
  }, [online, lat, lng, approximate, provider]);

  if (!online || tilesFailed) {
    return (
      <div className="flex min-h-[6rem] items-center gap-3 rounded-2xl border-2 border-slate-900 bg-slate-100 p-3 text-[1rem] font-semibold text-slate-900" data-testid="map-offline">
        <WifiOff className="h-8 w-8 shrink-0" aria-hidden />
        <span>{t('map.offline')}</span>
      </div>
    );
  }
  return <div ref={ref} className="h-[8rem] w-full overflow-hidden rounded-2xl border-2 border-slate-900" aria-hidden />;
}
