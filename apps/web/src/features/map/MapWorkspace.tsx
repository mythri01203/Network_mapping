import React from 'react';

import { useUiStore } from '../../stores/uiStore';
import { ComponentLibrary } from '../catalog/ComponentLibrary';
import { PropertiesPanel } from '../inspector/PropertiesPanel';
import { BottomInfoPanel } from './BottomInfoPanel';
import { GISMap } from './GISMap';

/**
 * The default route: component library, map canvas with the bottom panel, and the inspector. In
 * Simple mode the library ("Add Boxes & Cables") is not shown, at the owner's request.
 */
export const MapWorkspace: React.FC = () => {
  const simple = useUiStore((s) => s.uiMode === 'simple');
  return (
    <>
      {!simple && <ComponentLibrary />}
      <div className="relative flex h-full flex-1 flex-col overflow-hidden">
        <div className="relative flex-1 overflow-hidden">
          <GISMap />
        </div>
        <BottomInfoPanel />
      </div>
      <PropertiesPanel />
    </>
  );
};
