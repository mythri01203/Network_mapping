/**
 * User-level network operations. Each is a thin adapter over a pure domain command from
 * `@fibergis/shared`, run through the network store so it gets toasts, confirmation, undo and audit.
 */
import type {
  AuditLog,
  Cable,
  CatalogComponent,
  Customer,
  Equipment,
  EquipmentImage,
  EquipmentPort,
  Fault,
  GpsRoute,
  ImageAnnotation,
  NetworkDocument,
  NetworkZone,
  SpliceRecord,
  Splitter,
  WorkOrder,
} from '@fibergis/shared';
import * as domain from '@fibergis/shared';

import { ApiError } from '../api/client';
import { syncEngine, type SyncOutcome } from '../api/syncEngine';
import { downloadFile } from '../lib/browser';
import { buildNetworkKml } from '../lib/kml';
import { currentAccount, loginIsOn } from './authStore';
import { requestConfirm } from './confirmStore';
import { useMapStore } from './mapStore';
import {
  type Command,
  type CommandOptions,
  getNetworkData,
  getNetworkSnapshot,
  selectOpticalSettings,
  useNetworkStore,
} from './networkStore';
import { useRestoreStore } from './restoreStore';
import { showToast } from './toastStore';
import { useTraceStore } from './traceStore';
import { useUiStore } from './uiStore';

const run = <T>(command: Command<T>, options?: CommandOptions) =>
  useNetworkStore.getState().runCommand(command, options);

// --- Equipment -----------------------------------------------------------------------------------

export const addEquipment = (draft: domain.EquipmentDraft): Equipment | null =>
  run((data, ctx) => domain.createEquipment(data, draft, ctx))?.value ?? null;

export const updateEquipment = (item: Equipment, options?: Pick<CommandOptions, 'silent'>) => {
  run((data) => domain.updateEquipment(data, item), options);
};

/** Deletes equipment after the user confirms; resolves `true` once it is removed. */
export async function deleteEquipment(id: string, options?: Pick<CommandOptions, 'skipConfirm'>): Promise<boolean> {
  const result = await useNetworkStore.getState().runConfirmedCommand((data) => domain.deleteEquipment(data, id), {
    ...options,
    confirmTitle: 'Delete equipment',
    confirmLabel: 'Delete',
  });
  if (!result) return false;
  const trace = useTraceStore.getState();
  if (trace.equipmentIds.includes(id)) trace.clear();
  return true;
}

/** Moves equipment and the matching ends of its cables as one undoable step. */
export const moveEquipment = (equipmentId: string, lat: number, lng: number): boolean =>
  run((data) => domain.moveEquipment(data, equipmentId, lat, lng)) !== null;

export const updateEquipmentPort = (equipmentId: string, portId: string, changes: Partial<EquipmentPort>) => {
  run((data) => domain.updateEquipmentPort(data, equipmentId, portId, changes));
};

/** Attaches a photo. Returns false when nothing was saved, so callers never report a false success. */
export const uploadEquipmentPhoto = (equipmentId: string, photo: Partial<EquipmentImage>): boolean =>
  run((data, ctx) => domain.addEquipmentPhoto(data, equipmentId, photo, ctx)) !== null;

// Annotations are stored beside the photo; the original image is never modified.
export const saveImageAnnotation = (equipmentId: string, imageId: string, annotation: ImageAnnotation) => {
  run((data) => domain.saveImageAnnotation(data, equipmentId, imageId, annotation));
};

export const deleteImageAnnotation = (equipmentId: string, imageId: string, annotationId: string) => {
  run((data) => domain.deleteImageAnnotation(data, equipmentId, imageId, annotationId));
};

// --- Cables, cores & splices ---------------------------------------------------------------------

export const addCable = (draft: domain.CableDraft): Cable | null =>
  run((data, ctx) => domain.createCable(data, draft, ctx))?.value ?? null;

export const updateCable = (item: Cable, options?: Pick<CommandOptions, 'silent'>) => {
  run((data) => domain.updateCable(data, item), options);
};

/** Deletes a cable after the user confirms; resolves `true` once it is removed. */
export async function deleteCable(id: string, options?: Pick<CommandOptions, 'skipConfirm'>): Promise<boolean> {
  const result = await useNetworkStore.getState().runConfirmedCommand((data) => domain.deleteCable(data, id), {
    ...options,
    confirmTitle: 'Delete cable',
    confirmLabel: 'Delete',
  });
  if (!result) return false;
  const trace = useTraceStore.getState();
  if (trace.cableIds.includes(id)) trace.clear();
  return true;
}

export const allocateFiberCore = (
  cableId: string,
  coreNumber: number,
  customerId?: string,
  equipmentId?: string,
  portName?: string,
): boolean =>
  run((data, ctx) => domain.allocateCore(data, { cableId, coreNumber, customerId, equipmentId, portName }, ctx)) !==
  null;

export const addSplice = (closureId: string, splice: SpliceRecord): boolean =>
  run((data) => domain.addSplice(data, closureId, splice)) !== null;

export const removeSplice = (closureId: string, spliceId: string) => {
  run((data) => domain.removeSplice(data, closureId, spliceId));
};

// --- Customers, faults & work orders -------------------------------------------------------------

export const addSplitter = (draft: domain.SplitterDraft): Splitter | null =>
  run((data, ctx) => domain.createSplitter(data, draft, ctx))?.value ?? null;

export const connectCustomerToPort = (draft: domain.CustomerDraft): Customer | null =>
  run((data, ctx) => domain.provisionCustomer(data, draft, ctx))?.value.customer ?? null;

/** Saves a customer's real position and redraws the drop to it, as one undoable step. */
export const setCustomerLocation = (customerId: string, location: domain.CustomerLocation): boolean =>
  run((data) => domain.setCustomerLocation(data, customerId, location)) !== null;

/** Links a customer to the path that now reaches their box. Only runs when a person asks. */
export const relinkCustomer = (customerId: string): boolean =>
  run((data, ctx) => domain.relinkCustomer(data, customerId, ctx)) !== null;

export const updateCustomer = (customerId: string, patch: Partial<Customer>): boolean =>
  run((data) => {
    const idx = data.customers.findIndex((c) => c.id === customerId);
    if (idx === -1) return domain.fail('Customer Missing', `Customer ${customerId} not found.`);
    const updated = { ...data.customers[idx], ...patch };
    const nextCustomers = [...data.customers];
    nextCustomers[idx] = updated;
    return domain.succeed(
      updated,
      { customers: nextCustomers },
      {
        notice: domain.notice('success', 'Customer Updated', `${updated.name} updated.`),
        audit: [{ action: 'CUSTOMER_UPDATED', details: `Updated ${customerId}`, assetId: customerId, assetType: 'Customer' }],
      },
    );
  }) !== null;

export const recordNewFault = (draft: domain.FaultDraft): Fault | null =>
  run((data, ctx) => domain.reportFault(data, draft, ctx))?.value ?? null;

/** Closes a fault. Refused without a check (Phase 8). */
export const resolveExistingFault = (faultId: string) => {
  run((data, ctx) => domain.setFaultStatus(data, faultId, 'Closed', {}, ctx));
};

/** Makes a work order with a random id (Phase 8), so two offline devices never clash. */
export const addWorkOrder = (draft: domain.JobDraft): WorkOrder | null =>
  run((data, ctx) => domain.createJob(data, draft, ctx))?.value ?? null;

/** Moves a work order. Verified and Closed are refused without a check (Phase 8). */
export const updateWorkOrderStatus = (workOrderId: string, status: WorkOrder['status']) => {
  run((data, ctx) => domain.setJobStatus(data, workOrderId, status, {}, ctx));
};

// --- Zones & documents ---------------------------------------------------------------------------

export const addZone = (draft: domain.ZoneDraft): NetworkZone | null =>
  run((data, ctx) => domain.createZone(data, draft, ctx))?.value ?? null;

export const updateZone = (zone: NetworkZone) => {
  run((data) => domain.updateZone(data, zone));
};

export const deleteZone = (id: string) => {
  run((data) => domain.deleteZone(data, id));
};

export const addDocument = (draft: domain.DocumentDraft): NetworkDocument | null =>
  run((data, ctx) => domain.createDocument(data, draft, ctx))?.value ?? null;

export const deleteDocument = (id: string) => {
  run((data) => domain.deleteDocument(data, id));
};

export const addCatalogComponent = (item: CatalogComponent) => useNetworkStore.getState().addCatalogComponent(item);

export const addGpsRoute = (route: GpsRoute) => useNetworkStore.getState().addGpsRoute(route);
export const deleteGpsRoute = (id: string) => useNetworkStore.getState().deleteGpsRoute(id);

export const logAudit = (action: string, details: string, assetId: string, assetType: AuditLog['assetType']) =>
  useNetworkStore.getState().logAudit({ action, details, assetId, assetType });

// --- Fiber trace ---------------------------------------------------------------------------------

/** Traces the physical path to an equipment, cable or customer id and opens the trace report. */
export function traceNetworkPath(targetId: string): boolean {
  const result = domain.resolveTraceTarget(targetId, getNetworkData(), selectOpticalSettings(useNetworkStore.getState()));
  if (!result || result.nodes.length === 0) {
    showToast('warning', 'Trace Not Available', `No traceable network path was found for "${targetId}".`);
    return false;
  }
  useTraceStore.getState().show(result);
  useUiStore.getState().setModalOpen('routeTrace', true);

  const { summary } = result;
  const budget = !summary.pathComplete
    ? ` · path not complete`
    : summary.estimatedRxDbm !== undefined
      ? ` · estimated Rx ${summary.estimatedRxDbm} dBm (${summary.budgetStatus})`
      : '';
  showToast(
    summary.budgetStatus === 'Fail' || summary.warnings.length > 0 ? 'warning' : 'info',
    summary.pathComplete ? 'Fiber Trace Active' : 'Fiber Trace: Path Not Complete',
    `${summary.targetLabel}: ${result.nodes.length} hops · ${(summary.totalLengthMeters / 1000).toFixed(2)} km${budget}`,
  );
  return true;
}

// --- Backup, restore, reset & export -------------------------------------------------------------

/** Selection, trace and sketches refer to records that may no longer exist after a bulk replace. */
function clearTransientState() {
  useUiStore.getState().select(null);
  useTraceStore.getState().clear();
  useMapStore.getState().resetSketches();
}

/** Reset, restore and full backups are the administrator's once login is on (Phase 9). */
function adminOnly(what: string): boolean {
  if (!loginIsOn()) return true;
  const account = currentAccount();
  if (account?.role === 'admin') return true;
  showToast('error', 'Administrator only', `Only the administrator can ${what}. Nothing was changed.`);
  return false;
}

/** The server's full backup, as a zip with every field photo (Phase 9). */
export async function downloadServerBackup(): Promise<boolean> {
  if (!adminOnly('download a full backup')) return false;
  try {
    const response = await fetch(`${(import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')}${domain.API_PREFIX}/backup?photos=1`, {
      credentials: import.meta.env.VITE_API_URL ? 'include' : 'same-origin',
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      showToast('error', 'Backup not downloaded', body?.message ?? `The server answered ${response.status}.`);
      return false;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fibergis-backup-${domain.isoDate()}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showToast('success', 'Backup downloaded', `The whole network and ${response.headers.get('x-backup-photos') ?? 'all'} photo(s). Keep it somewhere safe: it holds customer details.`);
    logAudit('BACKUP_EXPORTED', `Downloaded a full backup with ${response.headers.get('x-backup-photos') ?? '?'} photo(s)`, 'SYSTEM', 'System');
    return true;
  } catch {
    showToast('error', 'Backup not downloaded', 'The server could not be reached. Try again with a connection.');
    return false;
  }
}

export function backupSystem() {
  if (!adminOnly('download a full backup')) return;
  const { projectStartPoint } = useNetworkStore.getState();
  const snapshot = getNetworkSnapshot();
  const backup = domain.createBackup(snapshot, new Date().toISOString(), projectStartPoint ?? undefined);
  downloadFile(JSON.stringify(backup, null, 2), 'application/json', `fiber_gis_backup_${domain.isoDate()}.json`);
  showToast('success', 'Backup Exported', 'Full network database downloaded as JSON.');
  logAudit(
    'BACKUP_EXPORTED',
    `Exported backup (${snapshot.equipment.length} equipment, ${snapshot.cables.length} cables, ${snapshot.customers.length} customers)`,
    'SYSTEM',
    'System',
  );
}

/**
 * Restores a backup file. The file is validated here; the data then goes to the server (or this
 * browser while offline). Resolves to whether anything was restored.
 */
/** What is in the network now, in words, for confirmations that replace it. */
function networkCounts(): string {
  const s = getNetworkSnapshot();
  const parts: [number, string][] = [
    [s.equipment.length, 'network items'],
    [s.cables.length, 'cables'],
    [s.customers.length, 'customers'],
    [s.faults.length, 'faults'],
    [s.workOrders.length, 'jobs'],
    [s.spans.length, 'spans'],
    [s.onts.length, 'ONTs'],
  ];
  return parts
    .filter(([n]) => n > 0)
    .map(([n, what]) => `${n} ${what}`)
    .join(', ');
}

/**
 * Restores a backup file: JSON (as before) or a zip with photos. The server checks it against the
 * link, fiber, connection and fault rules and saves a safety copy first. A refused backup is listed
 * on the Backup screen with "restore anyway" for the administrator.
 */
export async function restoreSystem(input: string | Blob, options: { acceptProblems?: boolean } = {}): Promise<boolean> {
  if (!adminOnly('restore a backup')) return false;
  let send: () => Promise<SyncOutcome>;
  let names: string[] = [];
  if (typeof input === 'string') {
    let raw: unknown;
    try {
      raw = JSON.parse(input);
    } catch {
      showToast('error', 'Restore Failed', 'The selected file is not valid JSON.');
      return false;
    }
    const parsed = domain.parseBackup(raw);
    if (!parsed.ok) {
      showToast('error', 'Restore Failed', parsed.error);
      return false;
    }
    names = Object.keys(parsed.backup.collections);
    send = () => syncEngine.restore(parsed.backup, options);
  } else {
    send = () => syncEngine.restoreZip(input, options);
  }

  if (!options.acceptProblems) {
    const confirmed = await requestConfirm({
      title: 'Replace the network with this backup?',
      message: `Now on the server: ${networkCounts() || 'nothing'}. ${
        names.length ? `The backup replaces: ${names.join(', ')}.` : 'The backup replaces every list it holds.'
      } Changes made since the backup will be lost. The server saves a safety copy first.`,
      confirmLabel: 'Replace with the backup',
      cancelLabel: 'Keep my network',
      tone: 'danger',
    });
    if (!confirmed) return false;
  }

  useRestoreStore.getState().setRefusal(null);
  let outcome;
  try {
    outcome = await send();
  } catch (error) {
    if (error instanceof ApiError && error.code === 'restore_refused') {
      const body = error.body as { total?: number; counts?: Record<string, number>; problems?: { rule: domain.RestoreRule; message: string; refs: string[] }[] };
      useRestoreStore.getState().setRefusal({
        message: error.message,
        total: body.total ?? body.problems?.length ?? 0,
        counts: body.counts ?? {},
        problems: body.problems ?? [],
        retryAccepting: () => restoreSystem(input, { acceptProblems: true }),
      });
      showToast('error', 'Backup refused', `${error.message} The list is under Administration, Backup.`);
      return false;
    }
    throw error;
  }
  if (outcome === 'failed') return false;
  clearTransientState();
  const result = useRestoreStore.getState().lastResult;
  showToast(
    'success',
    'System Restored',
    `Restored ${result?.restored.length ?? names.length} list(s). Safety copy on the server: ${result?.safetyCopy ?? 'made'}.${result?.photosAdded ? ` ${result.photosAdded} photo(s) added.` : ''}`,
  );
  return true;
}

/** Reloads the demo network over everything except the catalog. Administrator only, safety copy first. */
export async function resetToSampleData(): Promise<boolean> {
  if (!adminOnly('reset the network')) return false;
  const confirmed = await requestConfirm({
    title: 'Replace your network with the sample?',
    message: `This deletes ${networkCounts() || 'everything in the network'} and loads the demo network instead. Only the custom equipment catalog is kept. The server saves a safety copy first (backups folder), but everyone will see the sample until it is restored.`,
    confirmLabel: 'Delete and load the sample',
    cancelLabel: 'Keep my network',
    tone: 'danger',
  });
  if (!confirmed) return false;
  const outcome = await syncEngine.reset();
  if (outcome === 'failed') return false;
  clearTransientState();
  showToast('info', 'Sample Data Restored', 'The network was replaced with the sample. A safety copy of the old one is in the server backups folder.');
  return true;
}

export function exportKML() {
  const { equipment, cables, customers } = getNetworkSnapshot();
  downloadFile(
    buildNetworkKml({ equipment, cables, customers }),
    'application/vnd.google-earth.kml+xml',
    `fiber_gis_network_${domain.isoDate()}.kml`,
  );
  showToast(
    'success',
    'KML Export Complete',
    `Exported ${equipment.length} equipment, ${cables.length} cables and ${customers.length} customers.`,
  );
}
