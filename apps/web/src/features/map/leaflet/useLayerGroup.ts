import { useEffect, useState } from 'react';
import L from 'leaflet';

/** A layer group that lives on `map` for as long as the calling component is mounted. */
export function useLayerGroup(map: L.Map): L.LayerGroup {
  const [group] = useState(() => L.layerGroup());
  useEffect(() => {
    group.addTo(map);
    return () => {
      group.remove();
    };
  }, [map, group]);
  return group;
}
