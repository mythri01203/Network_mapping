import {
  Map as MapIcon,
  Network,
  Server,
  Boxes,
  Cable,
  Users,
  Tv,
  Hexagon,
  ClipboardList,
  HardHat,
  Settings2,
  type LucideIcon,
} from 'lucide-react';
import type { MainView } from '../../types/network';

export interface ViewMeta {
  label: string;
  description: string;
  icon: LucideIcon;
}

export const VIEW_META: Record<MainView, ViewMeta> = {
  map: { label: 'Network Map', description: 'GIS workspace for the outside plant', icon: MapIcon },
  topology: { label: 'Topology', description: 'Logical OLT to ONT hierarchy', icon: Network },
  olt_rack: { label: 'OLT Rack', description: 'Central office chassis and PON ports', icon: Server },
  inventory: { label: 'Equipment', description: 'All network equipment', icon: Boxes },
  cables: { label: 'Cables', description: 'Fiber and coaxial cable inventory', icon: Cable },
  customers: { label: 'Customers', description: 'Subscribers and ONT service', icon: Users },
  cable_tv: { label: 'Cable TV', description: 'HFC nodes, amplifiers and taps', icon: Tv },
  zones: { label: 'Zones', description: 'Service areas and coverage', icon: Hexagon },
  operations: { label: 'Operations', description: 'Faults and work orders', icon: ClipboardList },
  field: { label: 'Field Work', description: 'Technician activity and navigation', icon: HardHat },
  admin: { label: 'Administration', description: 'Users, configuration and data', icon: Settings2 },
};

export const ROLE_INITIALS = (role: string) =>
  role
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
