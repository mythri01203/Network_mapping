import {
  Box,
  Building2,
  Cable,
  CircleDashed,
  CircleDot,
  Combine,
  Container,
  Cpu,
  Disc,
  HardDrive,
  House,
  Network,
  PanelsTopLeft,
  RadioTower,
  Router,
  Rows3,
  SatelliteDish,
  Server,
  Shield,
  Signal,
  Split,
  Spline,
  SquareDashed,
  Tv,
  UtilityPole,
  Warehouse,
  Waypoints,
  Wifi,
  type LucideIcon,
} from 'lucide-react';
import type { CableType, EquipmentType } from '../../types/network';

export const EQUIPMENT_ICONS: Record<EquipmentType, LucideIcon> = {
  OLT: Server,
  ODF: PanelsTopLeft,
  'Fiber Patch Panel': Rows3,
  'Core Switch': Network,
  Router: Router,
  Firewall: Shield,
  'Optical Transmitter': Signal,
  'Headend Equipment': SatelliteDish,
  FDMS: Container,
  FDT: Container,
  FAT: Box,
  'Fiber Distribution Cabinet': Container,
  'Fiber Terminal Box': Box,
  'Pole-Mounted Terminal Box': Box,
  'Wall-Mounted Terminal Box': Box,
  'Underground Terminal Box': Box,
  'Fiber Splitter': Split,
  'Fiber Joint Closure': Combine,
  'Splice Closure': Combine,
  'Distribution Point': CircleDot,
  'Telecom Pole': UtilityPole,
  'Electric Pole': UtilityPole,
  Manhole: Disc,
  Handhole: SquareDashed,
  'Underground Chamber': Warehouse,
  Duct: Spline,
  Microduct: Spline,
  'Cable Tray': Rows3,
  'Building Entry Point': Building2,
  'Junction Point': Waypoints,
  ONT: HardDrive,
  ONU: HardDrive,
  'Wi-Fi Router': Wifi,
  'Optical Modem': HardDrive,
  'Customer Terminal': House,
  'Set-Top Box': Tv,
  'Cable TV Headend': SatelliteDish,
  'CATV Optical Node': RadioTower,
  'CATV RF Amplifier': Cpu,
  'CATV Tap-Off Box': CircleDashed,
};

export function equipmentIcon(type: string | undefined | null): LucideIcon {
  return (type && EQUIPMENT_ICONS[type as EquipmentType]) || Box;
}

/** Restrained, print-safe palette for cable classes (map strokes, legends, chips). */
export const CABLE_TYPE_COLORS: Record<CableType, string> = {
  'Main Feeder Fiber': '#1d4ed8',
  'Distribution Fiber': '#0891b2',
  'Drop Fiber': '#16a34a',
  'Aerial Fiber': '#7c3aed',
  'Underground Fiber': '#475569',
  'Coaxial Cable': '#c2410c',
  'Custom Cable': '#64748b',
};

export function cableColor(type: string | undefined | null): string {
  return (type && CABLE_TYPE_COLORS[type as CableType]) || '#64748b';
}

export const CableIcon = Cable;
