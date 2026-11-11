import { useEffect, useState } from 'react';
import type L from 'leaflet';

import { metersPerPixel } from '@fibergis/shared';

import { cn } from '../../components/ui';
import { formatScale, niceScaleMeters } from './mapScale';

/** Longest scale bar on screen, in pixels. */
const MAX_BAR_PX = 110;

/** Scale bar worked out from the map's centre latitude and zoom, so it stays true as the map moves. */
function useScale(map: L.Map) {
  const read = () => {
    const mpp = metersPerPixel(map.getCenter().lat, map.getZoom());
    const meters = niceScaleMeters(mpp * MAX_BAR_PX);
    return { meters, px: mpp > 0 ? Math.round(meters / mpp) : 0 };
  };
  const [scale, setScale] = useState(read);
  useEffect(() => {
    const update = () => setScale(read());
    map.on('zoomend moveend', update);
    return () => {
      map.off('zoomend moveend', update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);
  return scale;
}

/** Where the pointer is, on screens with a mouse. Null when the pointer is off the map. */
function usePointerPosition(map: L.Map) {
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    let frame = 0;
    const onMove = (e: L.LeafletMouseEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setPos({ lat: e.latlng.lat, lng: e.latlng.lng }));
    };
    const onOut = () => {
      cancelAnimationFrame(frame);
      setPos(null);
    };
    map.on('mousemove', onMove);
    map.on('mouseout', onOut);
    return () => {
      cancelAnimationFrame(frame);
      map.off('mousemove', onMove);
      map.off('mouseout', onOut);
    };
  }, [map]);
  return pos;
}

/** Scale bar (all screens) and pointer coordinates (screens with a mouse), in WGS84 degrees. */
export function MapStatus({ map }: { map: L.Map }) {
  const scale = useScale(map);
  const pointer = usePointerPosition(map);
  return (
    <div
      className={cn(
        'pointer-events-none absolute left-2 top-[60px] z-[400] flex flex-col items-start gap-1',
        'md:bottom-[60px] md:left-4 md:top-auto',
      )}
      data-testid="map-status"
    >
      {scale.px > 0 && (
        <div className="rounded bg-white/85 px-1.5 pb-0.5 pt-1 text-[11px] font-medium text-slate-800 shadow-sm" data-testid="map-scale">
          <div className="h-1.5 border-x-2 border-b-2 border-slate-800" style={{ width: scale.px }} aria-hidden />
          <span>{formatScale(scale.meters)}</span>
        </div>
      )}
      {pointer && (
        <div className="hidden rounded bg-white/85 px-1.5 py-0.5 font-mono text-[11px] text-slate-700 shadow-sm md:block" data-testid="map-pointer">
          {pointer.lat.toFixed(6)}, {pointer.lng.toFixed(6)}
        </div>
      )}
    </div>
  );
}
