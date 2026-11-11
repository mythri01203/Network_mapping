/**
 * Customer and connection operations for the office screens (Phase 5): ONT records, services,
 * disconnect and move, buildings and units. Each wraps a pure command from `@fibergis/shared`, so it
 * gets undo, audit, toasts and sync, and the same checks the server runs. A warning is shown first;
 * saving anyway is written to the audit trail.
 */
import * as domain from '@fibergis/shared';

import { type Command, useNetworkStore } from './networkStore';

const run = async <T>(command: Command<T>, label = 'Save anyway'): Promise<T | null> =>
  (await useNetworkStore.getState().runConfirmedCommand(command, { confirmTitle: 'Please check', confirmLabel: label }))?.value ?? null;

// --- ONTs ----------------------------------------------------------------------------------------
export const addOnt = (draft: domain.OntDraft) => run((d, ctx) => domain.createOnt(d, draft, ctx));
export const saveOnt = (ontId: string, draft: domain.OntDraft) => run((d, ctx) => domain.saveOntDetails(d, ontId, draft, ctx));
export const markOnt = (ontId: string, status: Exclude<domain.OntStatus, 'removed'>, note: string) => run((d, ctx) => domain.setOntStatus(d, ontId, status, note, ctx));
export const makeOntRecord = (customerId: string) => run((d, ctx) => domain.adoptCustomerOnt(d, customerId, ctx));
export const changeCustomerOnt = (customerId: string, ontId: string, reason: string) => run((d, ctx) => domain.attachCustomerToOnt(d, customerId, ontId, reason, ctx));
export const swapCustomerOnt = (customerId: string, draft: domain.OntDraft, reason: string) => run((d, ctx) => domain.swapOnt(d, customerId, draft, reason, ctx));

// --- Disconnect and move -------------------------------------------------------------------------
export const disconnect = (customerId: string, reason: string) => run((d, ctx) => domain.disconnectCustomer(d, customerId, reason, ctx));
export const moveTo = (customerId: string, target: domain.MoveTarget, reason: string) => run((d, ctx) => domain.moveCustomer(d, customerId, target, reason, ctx));

// --- Phase 12: customer paths from the fibre links ----------------------------------------------
/** Takes the chosen customers' path fields from the fibre links, after a person confirmed the list. */
export const fixCustomerPaths = (customerIds: readonly string[]) => run((d, ctx) => domain.reconcileCustomerPaths(d, customerIds, ctx));
/** Records the drop fiber a customer is on; the OLT side then comes from the links. */
export const linkDropToCustomer = (customerId: string, link: domain.CustomerDropLink) => run((d, ctx) => domain.linkCustomerDrop(d, customerId, link, ctx));

// --- Services ------------------------------------------------------------------------------------
export const saveCustomerService = (draft: domain.ServiceDraft) => run((d, ctx) => domain.saveService(d, draft, ctx));
export const endCustomerService = (serviceId: string, reason: string) => run((d, ctx) => domain.endService(d, serviceId, reason, ctx));

// --- Buildings -----------------------------------------------------------------------------------
export const setUpBuilding = (draft: domain.BuildingDraft) => run((d, ctx) => domain.createBuilding(d, draft, ctx));
export const saveBuilding = (buildingId: string, details: domain.BuildingDetails) => run((d, ctx) => domain.saveBuildingDetails(d, buildingId, details, ctx));
export const addBuildingFloorBox = (buildingId: string, draft: domain.FloorBoxDraft) => run((d, ctx) => domain.addFloorBox(d, buildingId, draft, ctx));
export const addUnit = (buildingId: string, draft: domain.UnitDraft) => run((d, ctx) => domain.addBuildingUnit(d, buildingId, draft, ctx));
export const removeUnit = (buildingId: string, unitId: string) => run((d, ctx) => domain.removeBuildingUnit(d, buildingId, unitId, ctx));
export const placeInUnit = (customerId: string, place: { buildingId: string; unitId?: string } | null) => run((d, ctx) => domain.placeCustomerInUnit(d, customerId, place, ctx));
