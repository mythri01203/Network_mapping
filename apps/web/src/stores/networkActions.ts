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

import { syncEngine } from '../api/syncEngine';
import { downloadFile } from '../lib/browser';
import { buildNetworkKml } from '../lib/kml';
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

export const resolveExistingFault = (faultId: string) => {
  run((data, ctx) => domain.resolveFault(data, faultId, ctx));
};

export const addWorkOrder = (draft: domain.WorkOrderDraft): WorkOrder | null =>
  run((data, ctx) => domain.createWorkOrder(data, draft, ctx))?.value ?? null;

export const updateWorkOrderStatus = (workOrderId: string, status: WorkOrder['status']) => {
  run((data, ctx) => domain.setWorkOrderStatus(data, workOrderId, status, ctx));
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

export function backupSystem() {
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
export async function restoreSystem(json: string): Promise<boolean> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    showToast('error', 'Restore Failed', 'The selected file is not valid JSON.');
    return false;
  }
  const parsed = domain.parseBackup(raw);
  if (!parsed.ok) {
    showToast('error', 'Restore Failed', parsed.error);
    return false;
  }

  const outcome = await syncEngine.restore(parsed.backup);
  if (outcome === 'failed') return false;
  const restored = Object.keys(parsed.backup.collections);
  clearTransientState();
  showToast(
    'success',
    'System Restored',
    `Restored ${restored.length} dataset(s): ${restored.join(', ')}${outcome === 'local' ? ' (offline; will sync when the server is back)' : ''}`,
  );
  logAudit('BACKUP_RESTORED', `Restored datasets: ${restored.join(', ')}`, 'SYSTEM', 'System');
  return true;
}

/** Reloads the demo network. The component catalog is user configuration, so it is kept. */
export async function resetToSampleData(): Promise<boolean> {
  const confirmed = await requestConfirm({
    title: 'Reset to sample data',
    message: 'Replace the entire network with the bundled sample dataset? All network changes will be lost.',
    confirmLabel: 'Reset network',
    tone: 'danger',
  });
  if (!confirmed) return false;
  const outcome = await syncEngine.reset();
  if (outcome === 'failed') return false;
  clearTransientState();
  showToast('info', 'Sample Data Restored', 'The network has been reset to the bundled sample dataset.');
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
