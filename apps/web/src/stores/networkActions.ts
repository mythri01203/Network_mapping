/**
 * User-level network operations. Each is a thin adapter over a pure domain command from
 * `@fibergis/shared`, run through the network store so it gets toasts, confirmation, undo and audit.
 */
import * as domain from '@fibergis/shared';
import type {
  AuditLog,
  Cable,
  CatalogComponent,
  Customer,
  Equipment,
  EquipmentImage,
  EquipmentPort,
  Fault,
  ImageAnnotation,
  NetworkDocument,
  NetworkZone,
  SpliceRecord,
  WorkOrder,
} from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';
import { confirmAction, downloadFile } from '../lib/browser';
import { buildNetworkKml } from '../lib/kml';
import { writeJson } from '../lib/storage';
import { useMapStore } from './mapStore';
import { type Command, type CommandOptions, getNetworkData, getNetworkSnapshot, useNetworkStore } from './networkStore';
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

export function deleteEquipment(id: string, options?: Pick<CommandOptions, 'skipConfirm'>): boolean {
  if (!run((data) => domain.deleteEquipment(data, id), options)) return false;
  const trace = useTraceStore.getState();
  if (trace.equipmentIds.includes(id)) trace.clear();
  return true;
}

export const updateEquipmentPort = (equipmentId: string, portId: string, changes: Partial<EquipmentPort>) => {
  run((data) => domain.updateEquipmentPort(data, equipmentId, portId, changes));
};

export const uploadEquipmentPhoto = (equipmentId: string, photo: Partial<EquipmentImage>) => {
  run((data, ctx) => domain.addEquipmentPhoto(data, equipmentId, photo, ctx));
};

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

export function deleteCable(id: string, options?: Pick<CommandOptions, 'skipConfirm'>): boolean {
  if (!run((data) => domain.deleteCable(data, id), options)) return false;
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

export const connectCustomerToPort = (draft: domain.CustomerDraft): Customer | null =>
  run((data, ctx) => domain.provisionCustomer(data, draft, ctx))?.value.customer ?? null;

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

export const logAudit = (action: string, details: string, assetId: string, assetType: AuditLog['assetType']) =>
  useNetworkStore.getState().logAudit({ action, details, assetId, assetType });

// --- Fiber trace ---------------------------------------------------------------------------------

/** Traces the physical path to an equipment, cable or customer id and opens the trace report. */
export function traceNetworkPath(targetId: string): boolean {
  const result = domain.resolveTraceTarget(targetId, getNetworkData());
  if (!result || result.nodes.length === 0) {
    showToast('warning', 'Trace Not Available', `No traceable network path was found for "${targetId}".`);
    return false;
  }
  useTraceStore.getState().show(result);
  useUiStore.getState().setModalOpen('routeTrace', true);

  const { summary } = result;
  const budget =
    summary.estimatedRxDbm !== undefined ? ` · est. Rx ${summary.estimatedRxDbm} dBm (${summary.budgetStatus})` : '';
  showToast(
    summary.budgetStatus === 'Fail' || summary.warnings.length > 0 ? 'warning' : 'info',
    'Fiber Trace Active',
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

export function restoreSystem(json: string): boolean {
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

  const { collections, projectStartPoint } = parsed.backup;
  const restored = Object.keys(collections);
  useNetworkStore.getState().replaceCollections(collections, projectStartPoint);
  clearTransientState();
  showToast('success', 'System Restored', `Restored ${restored.length} dataset(s): ${restored.join(', ')}`);
  logAudit('BACKUP_RESTORED', `Restored datasets: ${restored.join(', ')}`, 'SYSTEM', 'System');
  return true;
}

export function resetToSampleData() {
  if (!confirmAction('Reset the entire network to the bundled sample dataset? All local changes will be lost.')) return;
  // The component catalog is user configuration, not network data, so it survives a reset.
  const { catalog } = useNetworkStore.getState();
  useNetworkStore.getState().replaceCollections({ ...createSampleNetwork(), catalog });
  clearTransientState();
  showToast('info', 'Sample Data Restored', 'The network has been reset to the bundled sample dataset.');
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

// --- Draft / publish (local prototype workflow) --------------------------------------------------

export function saveDraft() {
  useUiStore.getState().setPublishState('draft');
  showToast(
    'info',
    'Draft Saved',
    'Changes are stored locally as a prototype draft. This is not a production database.',
  );
}

export function publishNetwork() {
  useUiStore.getState().setPublishState('published');
  writeJson('published_at', new Date().toISOString());
  showToast(
    'success',
    'Published (prototype)',
    'A local published snapshot was stored. No live GIS or hardware sync is connected.',
  );
}
