import React from 'react';

import { ComponentLibrary } from '../catalog/ComponentLibrary';
import { PropertiesPanel } from '../inspector/PropertiesPanel';
import { BottomInfoPanel } from './BottomInfoPanel';
import { GISMap } from './GISMap';

/** The default route: component library, map canvas with the bottom panel, and the inspector. */
export const MapWorkspace: React.FC = () => (
  <>
    <ComponentLibrary />
    <div className="relative flex h-full flex-1 flex-col overflow-hidden">
      <div className="relative flex-1 overflow-hidden">
        <GISMap />
      </div>
      <BottomInfoPanel />
    </div>
    <PropertiesPanel />
  </>
);
