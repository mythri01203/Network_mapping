import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import L from 'leaflet';

export interface MapPopupProps {
  map: L.Map;
  latlng: [number, number];
  /** Called when Leaflet closes the popup (close button, Escape, another popup opening). */
  onClose: () => void;
  /** Pixel offset from the anchor, e.g. half the marker height. */
  offsetY?: number;
  children: ReactNode;
}

/** A Leaflet popup whose content is rendered by React. Mount it to open, unmount it to close. */
export function MapPopup({ map, latlng, onClose, offsetY = 0, children }: MapPopupProps) {
  const [container] = useState(() => document.createElement('div'));
  const onCloseRef = useRef(onClose);
  const [lat, lng] = latlng;

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const popup = L.popup({
      className: 'gis-popup',
      closeOnClick: false,
      maxWidth: 320,
      minWidth: 264,
      offset: L.point(0, -offsetY),
      autoPanPadding: L.point(24, 24),
    })
      .setLatLng([lat, lng])
      .setContent(container);

    let unmounting = false;
    popup.on('remove', () => {
      if (!unmounting) onCloseRef.current();
    });
    popup.openOn(map);

    return () => {
      unmounting = true;
      popup.remove();
    };
  }, [map, container, lat, lng, offsetY]);

  return createPortal(children, container);
}
