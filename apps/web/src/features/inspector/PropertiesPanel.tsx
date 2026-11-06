import {
  BookOpen,
  GitMerge,
  type LucideIcon,
  MapPin,
  MousePointerClick,
  PanelRightClose,
  PanelRightOpen,
  TriangleAlert,
  UserRound,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { EquipmentIllustration } from '../../components/icons/EquipmentIllustration';
import { Badge, CableIcon, cn, EmptyState, equipmentIcon, IconButton, StatusBadge } from '../../components/ui';
import { type SelectedObject, selectionLabel, useUiStore } from '../../stores/uiStore';
import { CableInspector } from './CableInspector';
import { ClosureInspector } from './ClosureInspector';
import { CustomerInspector } from './CustomerInspector';
import { EquipmentInspector } from './EquipmentInspector';
import { FaultInspector } from './FaultInspector';
import { joinPresent } from './format';

interface HeaderModel {
  icon: LucideIcon;
  /** Equipment type whose illustration replaces the icon. */
  illustration?: string;
  tint: string;
  kind: string;
  status?: string;
  tags: ReactNode[];
  location?: string;
}

function headerFor(selection: SelectedObject): HeaderModel {
  switch (selection.type) {
    case 'equipment': {
      const eq = selection.data;
      return {
        icon: equipmentIcon(eq.type),
        illustration: eq.type,
        tint: 'bg-white text-blue-700 ring-slate-200',
        kind: eq.type,
        status: eq.status,
        tags: eq.technology ? [<Badge key="tech">{eq.technology}</Badge>] : [],
        location: joinPresent([eq.street, eq.area], ', '),
      };
    }
    case 'cable': {
      const cable = selection.data;
      return {
        icon: CableIcon,
        tint: 'bg-cyan-50 text-cyan-700 ring-cyan-100',
        kind: cable.type,
        status: cable.status,
        tags: [<Badge key="fibers">{cable.fiberCount} F</Badge>],
      };
    }
    case 'customer': {
      const customer = selection.data;
      return {
        icon: UserRound,
        tint: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
        kind: 'Subscriber',
        status: customer.status,
        tags: [<Badge key="service">{customer.serviceType}</Badge>],
        location: joinPresent([customer.address, customer.area], ', '),
      };
    }
    case 'closure':
      return {
        icon: GitMerge,
        tint: 'bg-violet-50 text-violet-700 ring-violet-100',
        kind: selection.data.closureType,
        tags: [],
        location: selection.data.area || undefined,
      };
    case 'fault': {
      const fault = selection.data;
      return {
        icon: TriangleAlert,
        tint: 'bg-red-50 text-red-700 ring-red-100',
        kind: 'Fault ticket',
        status: fault.status,
        tags: [<StatusBadge key="severity" status={fault.severity} label={`${fault.severity} severity`} dot={false} />],
        location: `${fault.affectedLocation.lat.toFixed(5)}, ${fault.affectedLocation.lng.toFixed(5)}`,
      };
    }
  }
}

function InspectorBody({ selection, detailed }: { selection: SelectedObject; detailed: boolean }) {
  switch (selection.type) {
    case 'equipment':
      return <EquipmentInspector equipment={selection.data} detailed={detailed} />;
    case 'cable':
      return <CableInspector cable={selection.data} detailed={detailed} />;
    case 'customer':
      return <CustomerInspector customer={selection.data} detailed={detailed} />;
    case 'closure':
      return <ClosureInspector closure={selection.data} />;
    case 'fault':
      return <FaultInspector fault={selection.data} />;
  }
}

const PANEL_CLASS = 'z-20 flex w-[22rem] shrink-0 flex-col border-l border-slate-200 bg-white';

/** Right-hand inspector for whatever is selected on the map. */
export function PropertiesPanel() {
  const { selection, isOpen, setPanelOpen, select, openKnowledge, uiMode } = useUiStore(
    useShallow((s) => ({
      selection: s.selectedObject,
      isOpen: s.panels.right,
      setPanelOpen: s.setPanelOpen,
      select: s.select,
      openKnowledge: s.openKnowledge,
      uiMode: s.uiMode,
    })),
  );

  if (!isOpen) {
    return (
      <IconButton
        icon={PanelRightOpen}
        label="Open inspector"
        variant="secondary"
        onClick={() => setPanelOpen('right', true)}
        className="absolute top-20 right-0 z-20 rounded-r-none border-r-0 shadow-sm"
      />
    );
  }

  const collapse = (
    <IconButton
      icon={PanelRightClose}
      label="Collapse inspector"
      size="sm"
      onClick={() => setPanelOpen('right', false)}
    />
  );

  if (!selection) {
    return (
      <aside aria-label="Inspector" className={PANEL_CLASS}>
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 px-4">
          <h2 className="text-sm font-semibold text-slate-900">Inspector</h2>
          {collapse}
        </div>
        <EmptyState
          icon={MousePointerClick}
          title="Nothing selected"
          description="Select equipment, a cable route, a subscriber or a fault on the map to see its details and tools."
          className="flex-1"
        />
      </aside>
    );
  }

  const header = headerFor(selection);
  const Icon = header.icon;
  const { id } = selection.data;

  return (
    <aside aria-label="Inspector" className={PANEL_CLASS}>
      <header className="shrink-0 border-b border-slate-200 px-4 pt-3.5 pb-3">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset',
              header.tint,
            )}
          >
            {header.illustration ? (
              <EquipmentIllustration type={header.illustration} size={30} />
            ) : (
              <Icon size={18} strokeWidth={1.9} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <h2
              className="truncate text-[15px] leading-snug font-semibold text-slate-900"
              title={selectionLabel(selection)}
            >
              {selectionLabel(selection)}
            </h2>
            <p className="truncate text-xs text-slate-500">
              {header.kind}
              <span className="px-1.5 text-slate-300">·</span>
              <span className="font-mono">{id}</span>
            </p>
          </div>
          <div className="-mt-0.5 -mr-1.5 flex shrink-0 items-center">
            {selection.type === 'equipment' && (
              <IconButton
                icon={BookOpen}
                label={`About ${selection.data.type}`}
                size="sm"
                onClick={() => openKnowledge(selection.data.type)}
              />
            )}
            <IconButton icon={X} label="Clear selection" size="sm" onClick={() => select(null)} />
            {collapse}
          </div>
        </div>
        {(header.status || header.tags.length > 0) && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 pl-12">
            {header.status && <StatusBadge status={header.status} />}
            {header.tags}
          </div>
        )}
        {header.location && (
          <p className="mt-2 flex items-center gap-1.5 truncate pl-12 text-xs text-slate-500">
            <MapPin size={12} className="shrink-0 text-slate-400" />
            <span className="truncate">{header.location}</span>
          </p>
        )}
      </header>
      <InspectorBody key={`${id}:${uiMode}`} selection={selection} detailed={uiMode === 'pro'} />
    </aside>
  );
}
