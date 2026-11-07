import { useEffect } from 'react';
import { AlertTriangle, MapPinned } from 'lucide-react';

import { useOpenView } from '../../app/views';
import { useAgentTrackingStore } from '../../stores/agentTrackingStore';
import { useNetworkStore } from '../../stores/networkStore';

/**
 * Keeps an active duty recording on every page, including after a reload, and shows that tracking
 * is on for as long as it runs.
 */
export function AgentTrackingRuntime() {
  const activeTripId = useAgentTrackingStore((s) => s.activeTripId);
  const gpsProblem = useAgentTrackingStore((s) => s.gpsProblem);
  const resumeDuty = useAgentTrackingStore((s) => s.resumeDuty);
  const agentName = useNetworkStore((s) => s.agentTrips.find((t) => t.id === activeTripId)?.agentName);
  const openView = useOpenView();

  useEffect(() => {
    resumeDuty();
  }, [resumeDuty]);

  if (!activeTripId) return null;

  return (
    <button
      type="button"
      onClick={() => openView('agent_tracking')}
      title={gpsProblem ?? 'Open Agent Tracking'}
      className={`fixed bottom-9 left-1/2 z-[900] flex max-w-[90vw] -translate-x-1/2 items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg ${
        gpsProblem ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-700 hover:bg-emerald-800'
      }`}
    >
      {gpsProblem ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> : <MapPinned className="h-3.5 w-3.5 shrink-0" />}
      <span className="truncate">
        {gpsProblem ? 'GPS interrupted' : 'Tracking active'}
        {agentName ? ` · ${agentName}` : ''}
      </span>
    </button>
  );
}
