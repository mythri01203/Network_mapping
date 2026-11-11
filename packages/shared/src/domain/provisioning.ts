import type { SplitterKind, SplitterRatio } from '../model/enums';
import type { Cable, CoreAssignment, Customer, Equipment, Splitter, SplitterPort } from '../model/types';
import { applyPatch, type CommandContext, type CommandResult, fail, type NetworkData, notice, sameId, succeed } from './command';
import { buildCores, hasRecordedLocation, isValidCoordinate } from './defaults';
import { activeAssignment, checkedFiberChange, completeCores, isCoreConditionStatus, type SplitterInput } from './fiberCommands';
import { coreKey, newFiberId } from './fiberIndex';
import { traceCoreUpstream } from './fiberPath';
import { polylineLengthMeters } from './geo';
import { newRecordId } from './ids';
import { DEFAULT_OPTICAL_SETTINGS } from './opticalSettings';
import { recountPonCustomers } from './ponUsage';
import { setPortUsage } from './ports';
import { isoDate } from './time';
import { estimateRxForSplitter } from './trace';

export type CustomerDraft = Partial<Customer>;

/** A drop made by `provisionCustomer` has two fibers. */
const NEW_DROP_FIBER_COUNT = 2;
/** The fiber of a new drop that carries the service when the draft names none (the spare is fiber 2). */
const NEW_DROP_FIBER = 1;

/** Equipment a subscriber's drop cable can terminate on. */
export const isCustomerTerminal = (type: string) =>
  type === 'FAT' || type.includes('Terminal Box') || type === 'Distribution Point';

export interface SplitterDraft {
  id?: string;
  name?: string;
  terminalBoxId: string;
  ratio: SplitterRatio;
  kind?: SplitterKind;
  /** Unequal coupler such as "90/10". Makes a two-output splitter with a loss per output. */
  couplerRatio?: string;
  /** The exact fiber or upstream splitter output that feeds the input, chosen by a person. */
  input?: SplitterInput;
}

/** Two outputs for an unequal coupler, each with its configured loss: the larger share is the through leg. */
function couplerPorts(couplerRatio: string, ctx: CommandContext): SplitterPort[] | string {
  const shares = couplerRatio.split('/').map((x) => Number(x.trim()));
  if (shares.length !== 2 || shares.some((x) => !Number.isFinite(x) || x <= 0) || Math.abs(shares[0] + shares[1] - 100) > 0.5) {
    return 'Write the coupler split as two shares that add to 100, such as 90/10.';
  }
  const optical = ctx.optical ?? DEFAULT_OPTICAL_SETTINGS;
  const big = Math.max(...shares);
  const key = `${big}/${100 - big}`;
  const loss = optical.couplers[key];
  return shares.map((share, i) => ({
    portNumber: i + 1,
    label: `${share}% leg`,
    status: 'Available' as const,
    ...(loss ? { lossDb: share === big ? loss.throughDb : loss.tapDb } : {}),
  }));
}

/** Installs a splitter in a terminal box so that subscribers can be provisioned on its output ports. */
export function createSplitter(
  data: NetworkData,
  draft: SplitterDraft,
  ctx: CommandContext = {},
): CommandResult<Splitter> {
  const terminal = data.equipment.find((e) => e.id === draft.terminalBoxId);
  if (!terminal) return fail('Terminal Not Found', `Terminal box ${draft.terminalBoxId} does not exist.`);

  const id =
    draft.id?.trim() || newRecordId('SPL-');
  if (data.splitters.some((s) => sameId(s.id, id))) {
    return fail('Duplicate Splitter ID', `Splitter ${id} already exists.`);
  }

  const ratio: SplitterRatio = draft.couplerRatio ? '1:2' : draft.ratio;
  const outputCount = Number(ratio.split(':')[1]);
  const coupler = draft.couplerRatio ? couplerPorts(draft.couplerRatio, ctx) : undefined;
  if (typeof coupler === 'string') return fail('Coupler split', coupler);
  // The input is linked only to what a person chose. A cable ending at the box is not proof.
  const input = draft.input;
  const created: Splitter = {
    id,
    name: draft.name?.trim() || (draft.couplerRatio ? `${draft.couplerRatio} coupler (${terminal.id})` : `${ratio} PLC Splitter (${terminal.id})`),
    terminalBoxId: terminal.id,
    ratio,
    insertionLossDb: draft.couplerRatio ? 0 : (ctx.optical ?? DEFAULT_OPTICAL_SETTINGS).splitterDb[ratio],
    lossSource: 'Settings default (proposed). Replace with the datasheet value.',
    kind: draft.kind ?? (draft.couplerRatio ? 'FBT' : 'PLC'),
    ...(draft.couplerRatio ? { couplerRatio: draft.couplerRatio } : {}),
    status: 'Active',
    installedAt: isoDate(ctx.now),
    inputPort: {
      id: `${id}-IN`,
      ...(input && 'cableId' in input ? { connectedCableId: input.cableId, connectedCore: input.core } : {}),
      ...(input && 'splitterId' in input ? { connectedSplitterId: input.splitterId, connectedSplitterPort: input.port } : {}),
    },
    outputPorts:
      coupler ??
      Array.from({ length: outputCount }, (_, i) => ({
        portNumber: i + 1,
        label: `OUT-${String(i + 1).padStart(2, '0')}`,
        status: 'Available' as const,
      })),
  };
  const splitters = [
    ...data.splitters.map((s) =>
      input && 'splitterId' in input && s.id === input.splitterId
        ? { ...s, outputPorts: s.outputPorts.map((p) => (p.portNumber === input.port ? { ...p, status: 'Occupied' as const } : p)) }
        : s,
    ),
    created,
  ];

  return checkedFiberChange(
    data,
    { splitters },
    created,
    {
      notice: notice('success', 'Splitter Installed', `Added ${created.ratio} splitter ${id} to ${terminal.id}.`),
      audit: [
        {
          action: 'SPLITTER_CREATED',
          details: `Installed ${created.ratio} splitter ${id} in ${terminal.id}`,
          assetId: terminal.id,
          assetType: 'Equipment',
        },
      ],
    },
    ctx,
  );
}

/** A gap sentence ready to sit inside another sentence. */
const plain = (gap: string | undefined) => (gap ?? 'the fiber path is not recorded').trim().replace(/\.$/, '');

/** A given reading keeps its stated origin. An estimate is stored as calculated. No estimate stores nothing. */
const readingFor = (
  draft: CustomerDraft,
  estimate: { rxDbm?: number; launchDbm?: number },
): Pick<Customer, 'rxOpticalPowerDbm' | 'rxSource' | 'rxMeasuredAt' | 'rxLaunchDbm'> => {
  if (draft.rxOpticalPowerDbm !== undefined) {
    return {
      rxOpticalPowerDbm: draft.rxOpticalPowerDbm,
      ...(draft.rxSource ? { rxSource: draft.rxSource } : {}),
      ...(draft.rxMeasuredAt ? { rxMeasuredAt: draft.rxMeasuredAt } : {}),
    };
  }
  if (estimate.rxDbm === undefined) return {};
  return {
    rxOpticalPowerDbm: estimate.rxDbm,
    rxSource: 'calculated',
    ...(estimate.launchDbm !== undefined ? { rxLaunchDbm: estimate.launchDbm } : {}),
  };
};

/**
 * Activates a subscriber on a splitter output port: creates the customer and a 2-core drop cable,
 * occupies the splitter and FAT ports. The logical path (OLT, PON, feeder/distribution cables,
 * estimated Rx) and the PON count are filled only from a fiber path recorded end to end, or from what
 * the draft names; otherwise they stay empty and the notice names the missing link. Facts nobody gave
 * stay blank: no generated serial or IP, and no made-up house position. A blank position leaves the
 * drop cable with no route or length until `setCustomerLocation` records one.
 */
export function provisionCustomer(
  data: NetworkData,
  draft: CustomerDraft,
  ctx: CommandContext = {},
): CommandResult<{ customer: Customer; dropCable: Cable }> {
  if (!draft.terminalBoxId || !draft.splitterId || !draft.splitterOutputPort) {
    return fail('Missing Connection Target', 'Please specify Terminal Box, Splitter, and Output Port.');
  }
  const fat = data.equipment.find((e) => e.id === draft.terminalBoxId);
  if (!fat) return fail('Terminal Not Found', `Access terminal ${draft.terminalBoxId} does not exist.`);

  const splitter = data.splitters.find((s) => s.id === draft.splitterId);
  if (!splitter) return fail('Splitter Not Found', `Splitter ${draft.splitterId} does not exist.`);
  if (splitter.terminalBoxId !== fat.id) {
    return fail(
      'Splitter Mismatch',
      `Splitter ${splitter.id} is installed in ${splitter.terminalBoxId}, not ${fat.id}.`,
    );
  }
  if (splitter.status === 'Faulty') {
    return fail(
      'Splitter Faulty',
      `Splitter ${splitter.id} is marked Faulty. Repair it before provisioning new subscribers.`,
    );
  }

  const port = splitter.outputPorts.find((p) => p.portNumber === draft.splitterOutputPort);
  if (!port) return fail('Invalid Port', `Splitter port ${draft.splitterOutputPort} does not exist.`);
  if (port.status === 'Occupied') {
    return fail(
      'Port Already Occupied',
      `Splitter Output Port ${port.portNumber} is already assigned to ${port.connectedCustomerName || port.connectedCustomerId}. Cannot double-book physical port.`,
    );
  }
  if (port.status === 'Faulty') {
    return fail('Port Faulty', `Splitter Output Port ${port.portNumber} is marked Faulty. Choose another port.`);
  }

  const ontSerial = draft.ontSerialNumber?.trim() || '';
  const duplicateOnt = ontSerial ? data.customers.find((c) => sameId(c.ontSerialNumber, ontSerial)) : undefined;
  if (duplicateOnt) {
    return fail(
      'Duplicate ONT Serial',
      `ONT ${ontSerial} is already registered to ${duplicateOnt.name} (${duplicateOnt.id}).`,
    );
  }

  const id =
    draft.id?.trim() || newRecordId('CUST-');
  if (data.customers.some((c) => sameId(c.id, id))) {
    return fail('Duplicate Customer ID', `Customer ${id} already exists.`);
  }

  const name = draft.name?.trim() || 'New Subscriber';
  // Subscriber location: as entered, or recorded as unknown (0, 0). Never an offset from the box.
  const draftPoint = { lat: draft.lat ?? Number.NaN, lng: draft.lng ?? Number.NaN };
  const hasLocation = isValidCoordinate(draftPoint.lat, draftPoint.lng) && hasRecordedLocation(draftPoint);
  const lat = hasLocation ? draftPoint.lat : 0;
  const lng = hasLocation ? draftPoint.lng : 0;

  const dropRoute: [number, number][] = hasLocation
    ? [
        [fat.lat, fat.lng],
        [lat, lng],
      ]
    : [];
  const dropLength = hasLocation ? Math.max(1, Math.round(polylineLengthMeters(dropRoute))) : 0;
  // This command makes the drop, so it names the drop's working fiber: the one the person gave, else
  // NEW_DROP_FIBER. That one number goes on the drop core, the customer and the splitter output.
  if (draft.fiberCore !== undefined && (!Number.isInteger(draft.fiberCore) || draft.fiberCore < 1 || draft.fiberCore > NEW_DROP_FIBER_COUNT)) {
    return fail('Invalid Drop Fiber', `The new drop has ${NEW_DROP_FIBER_COUNT} fibers, so fiber ${draft.fiberCore} does not exist.`);
  }
  const dropCore = draft.fiberCore ?? NEW_DROP_FIBER;
  const dropId = newRecordId('DROP-');
  const dropCable: Cable = {
    id: dropId,
    name: `Drop ${fat.id} → ${id}`,
    type: 'Drop Fiber',
    fiberCount: NEW_DROP_FIBER_COUNT,
    lengthMeters: dropLength,
    owner: '',
    installationDate: isoDate(ctx.now),
    status: 'Active',
    remarks: `Auto-created during provisioning of ${id}`,
    coordinates: dropRoute,
    startEquipmentId: fat.id,
    cores: buildCores(NEW_DROP_FIBER_COUNT).map((core) =>
      core.coreNumber === dropCore
        ? {
            ...core,
            status: 'In Use' as const,
            customerId: id,
            customerName: name,
            connectedToEquipmentId: fat.id,
            connectedPort: `${splitter.id}/OUT-${port.portNumber}`,
            remarks: `Drop to ${id}`,
            assignments: [
              {
                id: newFiberId('CA'),
                kind: 'in_use' as const,
                use: `Customer ${id}`,
                source: `${splitter.id} output ${port.portNumber}`,
                destination: `ONT of ${name}`,
                customerId: id,
                effectiveFrom: isoDate(ctx.now),
                createdAt: (ctx.now ?? new Date()).toISOString(),
                ...(ctx.actor ? { createdBy: ctx.actor } : {}),
              },
            ],
          }
        : core,
    ),
    cableCategory: 'Fiber',
  };

  const optical = ctx.optical ?? DEFAULT_OPTICAL_SETTINGS;
  const estimate = estimateRxForSplitter(fat, splitter, data, dropLength, optical);
  // Only a path recorded fiber by fiber is stored. A cable-level walk is a guess and stays out.
  const recorded = estimate.level === 'core' ? estimate : undefined;
  const feederId = recorded?.cableIds[0];
  const distributionId = recorded && recorded.cableIds.length > 1 ? recorded.cableIds[recorded.cableIds.length - 1] : undefined;
  // Phase 12: the fibre links are the one source of truth. A path field the person named that the
  // recorded links contradict is broken data, so nothing is saved.
  if (recorded) {
    const fromLinks: [string, string | undefined, string | undefined][] = [
      ['OLT', draft.oltId, recorded.olt?.id],
      ['PON port', draft.ponPort, recorded.pon?.id],
      ['feeder cable', draft.feederCableId, feederId],
      ['distribution cable', draft.distributionCableId, distributionId ?? feederId],
    ];
    const clash = fromLinks.find(([, given, linked]) => !!given && !!linked && given !== linked);
    if (clash) {
      return fail('Path does not match the fibres', `Broken data: you chose ${clash[0]} ${clash[1]}, but the fibre links from ${splitter.name} lead to ${clash[2]}. Nothing was saved.`);
    }
  }

  const customer: Customer = {
    id,
    name,
    mobile: draft.mobile || '',
    address: draft.address || '',
    area: draft.area || fat.area,
    building: draft.building,
    flatNumber: draft.flatNumber,
    lat,
    lng,
    ...(hasLocation && draft.locationMethod ? { locationMethod: draft.locationMethod } : {}),
    ...(hasLocation && draft.locationAccuracyMeters !== undefined
      ? { locationAccuracyMeters: draft.locationAccuracyMeters }
      : {}),
    serviceType: draft.serviceType || 'Fiber Broadband',
    plan: draft.plan || '',
    status: draft.status || 'Active',
    installationDate: isoDate(ctx.now),
    oltId: draft.oltId || recorded?.olt?.id || '',
    ponPort: draft.ponPort || recorded?.pon?.id || '',
    feederCableId: draft.feederCableId || feederId || '',
    distributionCableId: draft.distributionCableId || distributionId || feederId || '',
    terminalBoxId: fat.id,
    splitterId: splitter.id,
    splitterOutputPort: port.portNumber,
    dropCableId: dropId,
    // The same fiber that is marked In Use on the drop and on the splitter output.
    fiberCore: dropCore,
    ontSerialNumber: ontSerial,
    routerModel: draft.routerModel || '',
    ipAddress: draft.ipAddress?.trim() || '',
    // An Rx estimate is stored only for a recorded path; a partial total would look better than it is.
    ...readingFor(draft, recorded ?? {}),
  };

  // The PON count follows only a recorded path or the person's own choice, never a cable-level walk.
  const servingPon = customer.oltId && customer.ponPort ? { oltId: customer.oltId, ponId: customer.ponPort } : undefined;
  const marked0 = data.equipment.map((e): Equipment => {
    if (e.id === fat.id) return setPortUsage(e, port.portNumber, true, id, isoDate(ctx.now));
    if (servingPon && e.id === servingPon.oltId) {
      return {
        ...e,
        ponPorts: e.ponPorts?.map((p) => (p.id === servingPon.ponId ? { ...p, status: 'Active' as const } : p)),
      };
    }
    return e;
  });
  // Phase 10: the cached PON count is set from the customer records, not raised by one.
  const equipment = recountPonCustomers(marked0, [...data.customers, customer], [servingPon?.oltId]);
  const splitters = data.splitters.map((s) =>
    s.id !== splitter.id
      ? s
      : {
          ...s,
          outputPorts: s.outputPorts.map((p) =>
            p.portNumber !== port.portNumber
              ? p
              : {
                  ...p,
                  status: 'Occupied' as const,
                  connectedCustomerId: id,
                  connectedCustomerName: name,
                  connectedDropCableId: dropId,
                  connectedCore: dropCore,
                  connectedAt: (ctx.now ?? new Date()).toISOString(),
                },
          ),
        },
  );

  const warnings: string[] = [];
  if (!recorded) {
    warnings.push(
      `the fiber path to the OLT is not complete (missing: ${estimate.gaps.slice(0, 2).map(plain).join('; ')}). ` +
        `${customer.oltId ? 'Only the OLT you chose was saved' : 'OLT, PON port and cables were left empty'} and no Rx was estimated, so this customer cannot be traced yet`,
    );
  }
  if (!hasLocation) warnings.push('the house location is not recorded, so the drop has no length');
  if (recorded?.rxDbm !== undefined && recorded.rxDbm < optical.rx.goodFloorDbm) {
    warnings.push(`estimated Rx ${recorded.rxDbm} dBm is weak`);
  }
  const basePatch = { cables: [...data.cables, dropCable], splitters, equipment, customers: [...data.customers, customer] };
  const marked = markServingCores(applyPatch(data, basePatch), splitter.id, ctx);
  const rxNote = recorded?.rxDbm !== undefined ? ` (estimated Rx ${recorded.rxDbm} dBm)` : '';
  const warningNote = warnings.length ? `. Check: ${warnings.join('; ')}` : '';
  const coreNote = `${marked.marked.length ? `. Fibers marked in use: ${marked.marked.join(', ')}` : ''}${marked.note ? `. Note: ${marked.note}` : ''}`;

  return succeed(
    { customer, dropCable },
    { ...basePatch, cables: marked.cables },
    {
      notice: notice(
        warnings.length ? 'warning' : 'success',
        recorded ? 'Customer Connected' : 'Customer Saved, Path Not Complete',
        `Activated ${name} on ${fat.id} port ${port.portNumber} via ${dropId}${rxNote}${coreNote}${warningNote}`,
      ),
      audit: [
        {
          action: 'CUSTOMER_CONNECTED',
          details: `Provisioned ${id} on ${splitter.id} port ${port.portNumber} (${fat.id}) with drop ${dropId}`,
          assetId: id,
          assetType: 'Customer',
        },
      ],
    },
  );
}

export interface CustomerLocation {
  lat: number;
  lng: number;
  method: NonNullable<Customer['locationMethod']>;
  accuracyMeters?: number;
}

/** Records a customer's real position and redraws their drop from the box to it, as one undoable step. */
export function setCustomerLocation(
  data: NetworkData,
  customerId: string,
  location: CustomerLocation,
): CommandResult<Customer> {
  const customer = data.customers.find((c) => c.id === customerId);
  if (!customer) return fail('Customer Missing', `Customer ${customerId} was not found.`);
  const { lat, lng, method, accuracyMeters } = location;
  if (!isValidCoordinate(lat, lng) || !hasRecordedLocation({ lat, lng })) {
    return fail('Invalid Location', 'Choose a real position for this customer.');
  }

  const updated: Customer = { ...customer, lat, lng, locationMethod: method, locationAccuracyMeters: accuracyMeters };
  const fat = data.equipment.find((e) => e.id === customer.terminalBoxId);
  const drop = data.cables.find((c) => c.id === customer.dropCableId);
  const cables =
    fat && drop
      ? data.cables.map((c) => {
          if (c.id !== drop.id) return c;
          const coordinates: [number, number][] = [
            [fat.lat, fat.lng],
            [lat, lng],
          ];
          return { ...c, coordinates, lengthMeters: Math.max(1, Math.round(polylineLengthMeters(coordinates))) };
        })
      : undefined;

  return succeed(
    updated,
    { customers: data.customers.map((c) => (c.id === customerId ? updated : c)), ...(cables ? { cables } : {}) },
    {
      notice: notice('success', 'Location Saved', `Saved where ${customer.name} is.`),
      audit: [
        {
          action: 'CUSTOMER_LOCATION_SET',
          details: `${customer.id} placed at [${lat.toFixed(5)}, ${lng.toFixed(5)}] by ${method}${accuracyMeters !== undefined ? ` (within ${Math.round(accuracyMeters)} m)` : ''}`,
          assetId: customer.id,
          assetType: 'Customer',
        },
      ],
    },
  );
}

/**
 * Links a customer to the path that now reaches their terminal box, for a customer added before the
 * path was recorded. Runs only when a person asks. Uses only the fibers on record from the splitter
 * input to a PON port; it never sets a splitter input or a PON count from a cable-level walk, and
 * says which link to record when the path is not complete.
 */
export function relinkCustomer(
  data: NetworkData,
  customerId: string,
  ctx: CommandContext = {},
): CommandResult<Customer> {
  const customer = data.customers.find((c) => c.id === customerId);
  if (!customer) return fail('Customer Missing', `Customer ${customerId} was not found.`);
  const fat = data.equipment.find((e) => e.id === customer.terminalBoxId);
  const splitter = data.splitters.find((s) => s.id === customer.splitterId);
  if (!fat || !splitter) {
    return fail('Cannot Link Yet', `${customer.name} has no terminal box and splitter on record. Connect them first.`, 'warning');
  }

  const drop = data.cables.find((c) => c.id === customer.dropCableId);
  const optical = ctx.optical ?? DEFAULT_OPTICAL_SETTINGS;
  const estimate = estimateRxForSplitter(fat, splitter, data, drop?.lengthMeters ?? 0, optical);
  // Linked only from fibers on record. A cable that ends at the box is not proof of the path.
  if (estimate.level !== 'core' || !estimate.olt) {
    const anyCable = estimate.hops.length > 0;
    return fail(
      'Cannot Link Yet',
      `${customer.name} was not linked: the fiber path from ${fat.name} to an OLT PON port is not recorded, and nothing is linked from a guess. ` +
        `Record this first: ${plain(estimate.gaps[0])}.` +
        (anyCable ? '' : ` If no cable reaches ${fat.name} yet, draw it first, ending on the box.`),
      'warning',
    );
  }

  const feederId = estimate.cableIds[0];
  const distributionId = estimate.cableIds.length > 1 ? estimate.cableIds[estimate.cableIds.length - 1] : undefined;
  const servesAlready = customer.oltId === estimate.olt.id && customer.ponPort === estimate.pon?.id;
  // A real reading stays. An unrecorded value or an older estimate gets the new estimate, if any.
  const keepsReading = customer.rxSource === 'field_measured' || customer.rxSource === 'device_reported';
  const reading: Partial<Customer> = keepsReading
    ? {}
    : { rxOpticalPowerDbm: undefined, rxSource: undefined, rxLaunchDbm: undefined, ...readingFor({}, estimate) };
  const updated: Customer = {
    ...customer,
    ...reading,
    oltId: estimate.olt.id,
    ponPort: estimate.pon?.id ?? '',
    feederCableId: feederId ?? '',
    distributionCableId: distributionId ?? feederId ?? '',
  };

  const servingPonId = estimate.pon?.id;
  // Phase 10: the cached PON counts of the old and new OLT are set from the customer records (the
  // old port used to keep its count when a customer was relinked elsewhere).
  const equipment =
    !servesAlready && servingPonId
      ? recountPonCustomers(
          data.equipment.map((e) =>
            e.id !== estimate.olt!.id ? e : { ...e, ponPorts: e.ponPorts?.map((p) => (p.id === servingPonId ? { ...p, status: 'Active' as const } : p)) },
          ),
          data.customers.map((c) => (c.id === customerId ? updated : c)),
          [customer.oltId, estimate.olt.id],
        )
      : undefined;
  // The splitter input is already on record (the path above starts from it); it is never set here.

  return succeed(
    updated,
    {
      customers: data.customers.map((c) => (c.id === customerId ? updated : c)),
      ...(equipment ? { equipment } : {}),
    },
    {
      notice: notice(
        estimate.pon ? 'success' : 'warning',
        'Customer Linked',
        estimate.pon
          ? `${customer.name} now traces to ${estimate.olt.name} port ${estimate.pon.id}.`
          : `${customer.name} now traces to ${estimate.olt.name}, but no PON port is linked to the cable. Choose a port on the cable.`,
      ),
      audit: [
        {
          action: 'CUSTOMER_RELINKED',
          details: `${customer.id} linked to ${estimate.olt.id}${estimate.pon ? ` ${estimate.pon.id}` : ''} via ${estimate.cableIds.join(', ')}`,
          assetId: customer.id,
          assetType: 'Customer',
        },
      ],
    },
  );
}

/**
 * Marks the feeder and distribution fibers that carry a splitter's light as in use, following the
 * recorded core path from the splitter input back to the PON port. A fiber already given to this
 * PON tree is left as it is; one reserved or used for something else is reported, not overwritten.
 * When the path is not recorded core by core, nothing is guessed: the first missing link is returned.
 */
export function markServingCores(
  data: NetworkData,
  splitterId: string,
  ctx: CommandContext = {},
): { cables: Cable[]; marked: string[]; note?: string } {
  const splitter = data.splitters.find((s) => s.id === splitterId);
  const input = splitter?.inputPort;
  if (!splitter || !input?.connectedCableId || !input.connectedCore) {
    return { cables: data.cables, marked: [], note: `feeder and distribution fibers were not marked: the input of ${splitterId} is not linked to a fiber` };
  }
  const path = traceCoreUpstream(input.connectedCableId, input.connectedCore, data, { settings: ctx.optical });
  const tree = path.olt && path.pon ? { oltId: path.olt.id, ponPortId: path.pon.id, use: `PON ${path.olt.id} / ${path.pon.id}` } : undefined;
  if (!tree) {
    return { cables: data.cables, marked: [], note: `feeder and distribution fibers were not marked: ${path.gaps[0] ?? 'the fiber path does not reach an OLT port'}` };
  }
  const wanted = new Set(path.coreKeys);
  const marked: string[] = [];
  const conflicts: string[] = [];
  const now = ctx.now ?? new Date();
  const cables = data.cables.map((cable) => {
    if (!path.cableIds.includes(cable.id)) return cable;
    let changed = false;
    const cores = completeCores(cable).map((core) => {
      if (!wanted.has(coreKey(cable.id, core.coreNumber))) return core;
      const active = activeAssignment(core);
      if (active) {
        if (active.oltId !== tree.oltId || active.ponPortId !== tree.ponPortId) conflicts.push(`${cable.id} fiber ${core.coreNumber} is ${active.kind === 'reserved' ? 'reserved' : 'used'} for ${active.use}`);
        return core;
      }
      changed = true;
      marked.push(`${cable.id} fiber ${core.coreNumber}`);
      const assignment: CoreAssignment = {
        id: newFiberId('CA'),
        kind: 'in_use',
        use: tree.use,
        oltId: tree.oltId,
        ponPortId: tree.ponPortId,
        destination: `Splitter ${splitter.id}`,
        effectiveFrom: isoDate(now),
        createdAt: now.toISOString(),
        ...(ctx.actor ? { createdBy: ctx.actor } : {}),
      };
      // Phase 7: a damaged, faulty or retired mark is kept; the fiber rules then warn about it.
      return { ...core, status: isCoreConditionStatus(core.status) ? core.status : ('In Use' as const), assignments: [...(core.assignments ?? []), assignment] };
    });
    return changed ? { ...cable, cores } : cable;
  });
  return {
    cables,
    marked,
    note: conflicts.length ? `these fibers carry this path but are recorded for something else: ${conflicts.join('; ')}` : undefined,
  };
}
