import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useMapStore } from '../../stores/mapStore';
import { Layers, Eye, EyeOff, X } from 'lucide-react';

export const AdvancedLayersDrawer: React.FC = () => {
  const {
    activeLayers,
    toggleLayer,
    layerOpacity,
    setLayerOpacity,
    isLayersDrawerOpen,
    setIsLayersDrawerOpen,
    mapTileProvider,
    setMapTileProvider,
  } = useMapStore(
    useShallow((s) => ({
      activeLayers: s.layers,
      toggleLayer: s.toggleLayer,
      layerOpacity: s.layerOpacity,
      setLayerOpacity: s.setLayerOpacity,
      isLayersDrawerOpen: s.isLayersDrawerOpen,
      setIsLayersDrawerOpen: s.setLayersDrawerOpen,
      mapTileProvider: s.tileProvider,
      setMapTileProvider: s.setTileProvider,
    })),
  );

  if (!isLayersDrawerOpen) return null;

  const layerCategories = [
    {
      name: 'Fiber Optical Cables',
      layers: [
        { key: 'feederCable', label: 'Feeder Cables (96F Trunk)', color: '#2563eb', defaultOpacity: 1.0 },
        { key: 'distributionCable', label: 'Distribution Cables (24F ADSS)', color: '#0d9488', defaultOpacity: 1.0 },
        { key: 'dropCable', label: 'Drop FTTH Cables (1F/2F)', color: '#f59e0b', defaultOpacity: 1.0 },
        { key: 'coaxialCable', label: 'Cable TV Coaxial RG-11/RG-6', color: '#ea580c', defaultOpacity: 1.0 },
      ],
    },
    {
      name: 'Physical Route Types',
      layers: [
        { key: 'undergroundCable', label: 'Underground Duct & Buried Routes', color: '#64748b', defaultOpacity: 0.9 },
        { key: 'aerialCable', label: 'Aerial Pole-Suspended Routes', color: '#0284c7', defaultOpacity: 0.9 },
      ],
    },
    {
      name: 'Optical Network Equipment',
      layers: [
        { key: 'olt', label: 'OLT Central Office Hubs', color: '#1e40af', defaultOpacity: 1.0 },
        { key: 'odf', label: 'ODF Optical Frames', color: '#3b82f6', defaultOpacity: 1.0 },
        { key: 'fdms', label: 'FDMS Distribution Cabinets', color: '#4f46e5', defaultOpacity: 1.0 },
        { key: 'fdt', label: 'FDT Branch Terminals', color: '#0f766e', defaultOpacity: 1.0 },
        { key: 'fat', label: 'FAT Access Terminal Boxes', color: '#d97706', defaultOpacity: 1.0 },
        { key: 'splitters', label: 'PLC Splitters (1:8 / 1:16)', color: '#8b5cf6', defaultOpacity: 1.0 },
        { key: 'cableTv', label: 'Cable TV Nodes & RF Amplifiers', color: '#c2410c', defaultOpacity: 1.0 },
      ],
    },
    {
      name: 'Supporting Civil Infrastructure',
      layers: [
        { key: 'poles', label: 'Telecom & Electric Poles', color: '#475569', defaultOpacity: 0.85 },
        { key: 'manholes', label: 'Manholes & Underground Chambers', color: '#334155', defaultOpacity: 0.85 },
      ],
    },
    {
      name: 'Subscribers & Outages',
      layers: [
        { key: 'customers', label: 'Customer Subscribers (ONTs)', color: '#16a34a', defaultOpacity: 1.0 },
        { key: 'faults', label: 'Active Outages & Fiber Cuts', color: '#dc2626', defaultOpacity: 1.0 },
        { key: 'labels', label: 'Map Labels & Equipment Tags', color: '#1e293b', defaultOpacity: 1.0 },
      ],
    },
  ];

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-88 bg-white border-l border-slate-200 shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-200 select-none">
      {/* Drawer Header */}
      <div className="h-14 px-4 border-b border-slate-200 flex items-center justify-between shrink-0 bg-slate-50">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-blue-600" />
          <h3 className="text-xs font-bold text-slate-800">Advanced GIS Layer Management</h3>
        </div>
        <button
          onClick={() => setIsLayersDrawerOpen(false)}
          className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200/50 rounded-lg transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Base Map Selector */}
      <div className="p-4 border-b border-slate-100 bg-slate-50/50">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2">
          Geographical Base Map
        </span>
        <div className="grid grid-cols-3 gap-2">
          {[
            { id: 'google_streets', label: 'Google Maps' },
            { id: 'google_satellite', label: 'Google Satellite' },
            { id: 'osm', label: 'OpenStreetMap' },
          ].map((tile) => (
            <button
              key={tile.id}
              onClick={() => setMapTileProvider(tile.id as any)}
              className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold border transition-all ${
                mapTileProvider === tile.id
                  ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {tile.label}
            </button>
          ))}
        </div>
      </div>

      {/* Layer Groups with Visibility & Opacity Sliders */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {layerCategories.map((cat) => (
          <div key={cat.name} className="space-y-2">
            <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">{cat.name}</h4>
            <div className="space-y-2.5">
              {cat.layers.map((layer) => {
                const isVisible = activeLayers[layer.key] ?? true;
                const opacity = layerOpacity[layer.key] ?? layer.defaultOpacity;

                return (
                  <div
                    key={layer.key}
                    className={`p-2.5 rounded-xl border transition-all ${
                      isVisible ? 'bg-white border-slate-200 shadow-2xs' : 'bg-slate-50/60 border-slate-100 opacity-60'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-3 h-3 rounded-full shrink-0 shadow-xs"
                          style={{ backgroundColor: layer.color }}
                        />
                        <span className="text-xs font-semibold text-slate-800">{layer.label}</span>
                      </div>
                      <button
                        onClick={() => toggleLayer(layer.key)}
                        className={`p-1 rounded-md transition-colors ${
                          isVisible ? 'text-blue-600 hover:bg-blue-50' : 'text-slate-400 hover:bg-slate-200'
                        }`}
                        title={isVisible ? 'Hide Layer' : 'Show Layer'}
                      >
                        {isVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      </button>
                    </div>

                    {/* Opacity Slider */}
                    {isVisible && (
                      <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between gap-3 text-[10px]">
                        <span className="text-slate-400 font-medium">Opacity: {Math.round(opacity * 100)}%</span>
                        <input
                          type="range"
                          min="0.2"
                          max="1.0"
                          step="0.05"
                          value={opacity}
                          onChange={(e) => setLayerOpacity(layer.key, parseFloat(e.target.value))}
                          className="w-28 h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer Legend Summary */}
      <div className="p-3 border-t border-slate-200 bg-slate-50 text-[11px] text-slate-500 text-center">
        Tip: Adjust opacity sliders for overlay transparency on satellite imagery.
      </div>
    </div>
  );
};
