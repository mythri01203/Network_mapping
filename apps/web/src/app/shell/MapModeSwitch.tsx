import React from 'react';
import { Cuboid, Map as MapIcon } from 'lucide-react';

import { useUiStore } from '../../stores/uiStore';
import { useActiveView, useOpenView, useShowOnMap } from '../views';

/**
 * "2D Map | 3D View" in the top bar. The selection travels both ways: what is picked on the map is
 * focused in 3D, and going back to 2D centres the map on what was picked in 3D.
 */
export const MapModeSwitch: React.FC = () => {
  const active = useActiveView();
  const openView = useOpenView();
  const showOnMap = useShowOnMap();
  const go2d = () => {
    const sel = useUiStore.getState().selectedObject;
    if (active === 'view3d' && sel) showOnMap(sel);
    else openView('map');
  };
  const item = (on: boolean, label: string, short: string, icon: React.ReactNode, onClick: () => void) => (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={`flex h-10 min-w-[44px] items-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium transition-colors md:h-8 ${
        on ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white'
      }`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
      <span className="sm:hidden">{short}</span>
    </button>
  );
  return (
    <div
      role="radiogroup"
      aria-label="Map view"
      className="flex shrink-0 items-center gap-0.5 rounded-lg border border-white/10 bg-white/[0.06] p-0.5"
    >
      {item(active === 'map', '2D Map', '2D', <MapIcon size={14} />, go2d)}
      {item(active === 'view3d', '3D View', '3D', <Cuboid size={14} />, () => openView('view3d'))}
    </div>
  );
};
