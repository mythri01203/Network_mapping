import React, { useState } from 'react';
import {
  Boxes,
  Building2,
  CircleDot,
  Cpu,
  Layers,
  MapPin,
  Network,
  Radio,
  Router,
  Server,
  Sparkles,
  Split,
  UtilityPole,
  X,
} from 'lucide-react';

import type { EquipmentCategory, EquipmentType } from '@fibergis/shared';

import { addCatalogComponent } from '../../stores/networkActions';
import { showToast } from '../../stores/toastStore';

export interface ToolboxItem {
  id: string;
  name: string;
  type: EquipmentType;
  category: EquipmentCategory;
  defaultPorts?: number;
  description: string;
  icon: React.ElementType;
  iconBg: string;
  badge?: string;
  isCustom?: boolean;
}

export const DEFAULT_TOOLBOX_ITEMS: ToolboxItem[] = [
  {
    id: 'tb-olt',
    name: 'OLT (Optical Line Terminal)',
    type: 'OLT',
    category: 'Central Office',
    defaultPorts: 16,
    description: 'Chassis optical terminal (GPON/EPON/XGS)',
    icon: Server,
    iconBg: 'bg-blue-600',
    badge: '16 Ports',
  },
  {
    id: 'tb-odf',
    name: 'ODF (Distribution Frame)',
    type: 'ODF',
    category: 'Central Office',
    defaultPorts: 48,
    description: 'High-density fiber termination panel',
    icon: Network,
    iconBg: 'bg-sky-600',
    badge: '48 Ports',
  },
  {
    id: 'tb-router',
    name: 'Router (Core / Edge / MikroTik)',
    type: 'MikroTik Router',
    category: 'Central Office',
    defaultPorts: 16,
    description: 'BGP/OSPF aggregation & gateway router',
    icon: Router,
    iconBg: 'bg-indigo-600',
    badge: '16 Ports',
  },
  {
    id: 'tb-splitter',
    name: 'Optical Splitter (PLC)',
    type: 'Outdoor Splitter',
    category: 'Fiber Distribution',
    defaultPorts: 8,
    description: 'Passive optical beam splitter (1:2 to 1:32)',
    icon: Split,
    iconBg: 'bg-purple-600',
    badge: '1:8 Standard',
  },
  {
    id: 'tb-fdb',
    name: 'Fiber Distribution Box (FDB)',
    type: 'FAT',
    category: 'Fiber Distribution',
    defaultPorts: 16,
    description: 'Wall or pole-mounted customer access terminal',
    icon: Boxes,
    iconBg: 'bg-emerald-600',
    badge: '16 Ports',
  },
  {
    id: 'tb-fdh',
    name: 'Fiber Distribution Hub (FDH)',
    type: 'FDT',
    category: 'Fiber Distribution',
    defaultPorts: 48,
    description: 'Feeder to distribution optical cross-connect hub',
    icon: Layers,
    iconBg: 'bg-teal-700',
    badge: '48 Ports',
  },
  {
    id: 'tb-closure',
    name: 'Joint Closure (Dome)',
    type: 'Fiber Joint Closure',
    category: 'Fiber Distribution',
    defaultPorts: 24,
    description: 'Underground or aerial splice dome enclosure',
    icon: CircleDot,
    iconBg: 'bg-amber-600',
    badge: 'Splice Tray',
  },
  {
    id: 'tb-cabinet',
    name: 'Network Cabinet / Rack',
    type: 'FDMS',
    category: 'Fiber Distribution',
    defaultPorts: 96,
    description: 'Outdoor weatherproof street enclosure cabinet',
    icon: Building2,
    iconBg: 'bg-cyan-700',
    badge: '96 Ports',
  },
  {
    id: 'tb-pole',
    name: 'Fiber Pole (Telecom Pole)',
    type: 'Telecom Pole',
    category: 'Supporting Infrastructure',
    defaultPorts: 0,
    description: 'Aerial cable suspension pole with bracket',
    icon: UtilityPole,
    iconBg: 'bg-slate-600',
    badge: 'Infrastructure',
  },
  {
    id: 'tb-manhole',
    name: 'Manhole / Chamber',
    type: 'Manhole',
    category: 'Supporting Infrastructure',
    defaultPorts: 0,
    description: 'Subsurface duct chamber and pull vault',
    icon: CircleDot,
    iconBg: 'bg-stone-700',
    badge: 'Underground',
  },
  {
    id: 'tb-onu',
    name: 'ONU (Optical Network Unit)',
    type: 'ONU',
    category: 'Customer Equipment',
    defaultPorts: 4,
    description: 'Subscriber multi-port modem with Wi-Fi gateway',
    icon: Radio,
    iconBg: 'bg-sky-500',
    badge: 'Subscriber',
  },
  {
    id: 'tb-ont',
    name: 'ONT (Single-Port Terminal)',
    type: 'ONT',
    category: 'Customer Equipment',
    defaultPorts: 1,
    description: 'Subscriber single-family fiber terminal',
    icon: Cpu,
    iconBg: 'bg-blue-500',
    badge: 'Modem',
  },
  {
    id: 'tb-customer',
    name: 'Customer Location',
    type: 'Customer Terminal',
    category: 'Customer Equipment',
    defaultPorts: 1,
    description: 'Residential or commercial subscriber premises',
    icon: MapPin,
    iconBg: 'bg-rose-600',
    badge: 'Premises',
  },
];


/**
 * The "Add Custom Equipment" window: saves a reusable equipment type to the catalogue, so it shows in
 * the map toolbar's Equipment list. Opened from the button at the end of that list.
 */
export function AddCustomEquipmentModal({ onClose }: { onClose: () => void }) {
  const [customName, setCustomName] = useState('');
  const [customType, setCustomType] = useState('Custom Network Node');
  const [customCategory, setCustomCategory] = useState<EquipmentCategory>('Fiber Distribution');
  const [customPorts, setCustomPorts] = useState(8);
  const [customDescription, setCustomDescription] = useState('');
  const [customColor, setCustomColor] = useState('bg-indigo-600');

  const handleSaveCustomEquipment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customName.trim()) {
      showToast('warning', 'Name Required', 'Please enter a name for the custom equipment.');
      return;
    }

    const componentId = `CUSTOM-${Date.now().toString(36).toUpperCase()}`;
    addCatalogComponent({
      id: componentId,
      name: customName.trim(),
      type: customType.trim() || 'Custom Equipment',
      category: customCategory,
      defaultPorts: customPorts,
      description: customDescription || `Custom ${customPorts}-port equipment`,
      iconBg: customColor,
      isCustom: true,
    });
    onClose();
  };

  return (
        <div className="modal-sheet fixed inset-0 z-[1250] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in select-none">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden flex flex-col text-slate-800">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center font-bold">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Add Custom Equipment</h3>
                  <p className="text-xs text-slate-500">Configure and save reusable hardware template</p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCustomEquipment} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Equipment Name *</label>
                <input
                  type="text"
                  required
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="e.g. Cisco ASR 9000, 4-Way Outdoor Node"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs focus:border-sky-500 outline-none"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Equipment Type</label>
                  <input
                    type="text"
                    value={customType}
                    onChange={(e) => setCustomType(e.target.value)}
                    placeholder="e.g. Switch, DWDM, Repeater"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs focus:border-sky-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Category</label>
                  <select
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value as EquipmentCategory)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs focus:border-sky-500 outline-none bg-white"
                  >
                    <option value="Central Office">Central Office</option>
                    <option value="Fiber Distribution">Fiber Distribution</option>
                    <option value="Supporting Infrastructure">Supporting Infrastructure</option>
                    <option value="Customer Equipment">Customer Equipment</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Number of Ports</label>
                  <input
                    type="number"
                    min={0}
                    max={576}
                    value={customPorts}
                    onChange={(e) => setCustomPorts(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs focus:border-sky-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Icon Color</label>
                  <div className="flex gap-1.5 pt-1">
                    {[
                      { class: 'bg-blue-600', name: 'Blue' },
                      { class: 'bg-indigo-600', name: 'Indigo' },
                      { class: 'bg-purple-600', name: 'Purple' },
                      { class: 'bg-emerald-600', name: 'Green' },
                      { class: 'bg-amber-600', name: 'Amber' },
                      { class: 'bg-rose-600', name: 'Rose' },
                    ].map((col) => (
                      <button
                        key={col.class}
                        type="button"
                        onClick={() => setCustomColor(col.class)}
                        className={`w-6 h-6 rounded-full ${col.class} border-2 transition-transform ${
                          customColor === col.class ? 'border-slate-900 scale-110 shadow-sm' : 'border-transparent'
                        }`}
                        title={col.name}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Description & Specs</label>
                <textarea
                  rows={2}
                  value={customDescription}
                  onChange={(e) => setCustomDescription(e.target.value)}
                  placeholder="e.g. 10G optical edge switch with redundant power supply"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs focus:border-sky-500 outline-none resize-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold shadow-md shadow-sky-600/30"
                >
                  Save Equipment Type
                </button>
              </div>
            </form>
          </div>
        </div>
  );
}
