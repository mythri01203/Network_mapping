import { useState } from 'react';
import { ArrowLeftRight, Copy, GitMerge, PenLine, Scissors } from 'lucide-react';

import type { Cable, Duct } from '@fibergis/shared';

import { useShowOnMap } from '../../app/views';
import { Button, Modal } from '../../components/ui';
import { useMapStore } from '../../stores/mapStore';
import { useUiStore } from '../../stores/uiStore';
import { ActionList, ActionRow, InspectorSection } from '../inspector/sections';
import { type RouteTool, useRouteEditStore } from '../map/sketch/routeEditStore';
import { joinCables, joinCandidates, lineOf, turnCableRound, turnDuctRound } from './cableRouteActions';

/** Opens the map on the line with the route tools, closing the panel on a phone so the map shows. */
function useStartRouteEdit() {
  const showOnMap = useShowOnMap();
  return (selection: { type: 'cable'; data: Cable } | { type: 'duct'; data: Duct }, tool: RouteTool = 'move') => {
    if (useMapStore.getState().activeTool !== 'select') useMapStore.getState().setActiveTool('select');
    showOnMap(selection);
    useRouteEditStore.getState().start({ kind: selection.type, id: selection.data.id }, tool);
    if (window.innerWidth < 768) useUiStore.getState().setPanelOpen('right', false);
  };
}

function JoinDialog({ cable, onClose }: { cable: Cable; onClose: () => void }) {
  const candidates = joinCandidates(cable.id);
  const [busy, setBusy] = useState(false);
  const join = async (otherId: string) => {
    setBusy(true);
    try {
      if (await joinCables(cable.id, otherId)) onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={`Join another cable into ${cable.name}`} icon={GitMerge} size="md" footer={<Button onClick={onClose}>Close</Button>}>
      <div className="space-y-3 text-[14px] text-slate-700">
        <p>Only a cable whose end meets an end of this one can be joined. {cable.name} keeps its id; the other is removed and everything that named it moves to {cable.name}.</p>
        {candidates.length === 0 && <p className="rounded-lg border border-slate-200 bg-slate-50 p-3">No cable meets this one end to end.</p>}
        {candidates.map(({ cable: other, problem }) => (
          <div key={other.id} className="rounded-lg border border-slate-200 p-3">
            <div className="font-semibold text-slate-900">{other.name}</div>
            <div className="text-[12px] text-slate-500">
              {other.id} · {other.fiberCount} fibres · {other.lengthMeters} m
            </div>
            {problem ? (
              <p className="mt-2 text-[13px] text-amber-800">{problem}</p>
            ) : (
              <Button variant="primary" className="mt-2 min-h-[48px] w-full" disabled={busy} onClick={() => void join(other.id)} data-testid={`join-${other.id}`}>
                Join {other.name} into this cable
              </Button>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}

/** Phase 5: the route tools in the cable panel. Every one is a tap, and each change is one undo step. */
export function CableRouteToolsSection({ cable }: { cable: Cable }) {
  const startEdit = useStartRouteEdit();
  const [joining, setJoining] = useState(false);
  const drawn = cable.coordinates.length >= 2;
  const sameRoute = () => {
    const map = useMapStore.getState();
    map.resetSketches();
    map.setDrawingPoints(lineOf(cable));
    map.setCableTypeToDraw(cable.type);
    // Only the count is offered; ends are proposed from the line and must be confirmed in the form.
    map.setCableDraftDefaults({ fiberCount: cable.fiberCount });
    useUiStore.getState().setModalOpen('cableWizard', true);
  };
  return (
    <InspectorSection title="Change the route" icon={PenLine} defaultOpen={false}>
      {!drawn ? (
        <p className="text-[13px] text-slate-600">This cable has no line drawn yet. Draw it with the cable tool first.</p>
      ) : (
        <ActionList>
          <ActionRow icon={PenLine} label="Change the line" hint="Move, add or remove points; make longer; cut off an end" onClick={() => startEdit({ type: 'cable', data: cable })} />
          <ActionRow icon={Scissors} label="Split into two cables" hint="Tap the point where it is cut" onClick={() => startEdit({ type: 'cable', data: cable }, 'split')} />
          <ActionRow icon={GitMerge} label="Join with another cable" hint="One that meets this one end to end" onClick={() => setJoining(true)} />
          <ActionRow icon={ArrowLeftRight} label="Turn round (swap From and To)" hint="Fibres and splices stay as they are" onClick={() => void turnCableRound(cable.id)} />
          <ActionRow icon={Copy} label="New cable on the same route" hint="Copies the line only; you choose the ends" onClick={sameRoute} />
        </ActionList>
      )}
      {joining && <JoinDialog cable={cable} onClose={() => setJoining(false)} />}
    </InspectorSection>
  );
}

/** Phase 5: the route tools for a duct: change the line and turn it round. */
export function DuctRouteTools({ duct }: { duct: Duct }) {
  const startEdit = useStartRouteEdit();
  return (
    <ActionList>
      <ActionRow icon={PenLine} label="Change the line" hint="Move, add or remove points; make longer; cut off an end" onClick={() => startEdit({ type: 'duct', data: duct })} />
      <ActionRow icon={ArrowLeftRight} label="Turn round (swap its ends)" hint="The cables in it stay" onClick={() => void turnDuctRound(duct.id)} />
    </ActionList>
  );
}
