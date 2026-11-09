import { z } from 'zod';

import { rxSourceSchema } from './enums';

/*
 * Cable TV and HFC plant (Phase 6). Kept apart from the PON records on purpose: an RF tree has
 * gain stages, loss that rises with frequency and power on the coax, so no PON splitter or core rule
 * is ever applied to it. Three collections:
 *
 *   rfElements  every box in the RF tree, with its directional ports
 *   rfLinks     one recorded connection from an output port to an input port (coax, fiber, jumper, power)
 *   rfLevels    one level with its unit, origin and test point offset
 *
 * Nothing here is worked out from position. A link exists only when a person recorded it.
 */

export const RF_ELEMENT_KINDS = [
  'headend',
  'cmts',
  'optical_transmitter',
  'edfa',
  'wdm',
  'optical_splitter',
  'optical_node',
  'mini_node',
  'rf_amplifier',
  'rf_splitter',
  'directional_coupler',
  'tap',
  'power_inserter',
  'power_supply',
  'stb',
  'cable_modem',
] as const;
export const rfElementKindSchema = z.enum(RF_ELEMENT_KINDS);
export type RfElementKind = z.infer<typeof rfElementKindSchema>;

/** What travels through a port. Optical becomes RF only inside a node. */
export const RF_SIGNALS = ['optical', 'rf', 'power'] as const;
export const rfSignalSchema = z.enum(RF_SIGNALS);
export type RfSignal = z.infer<typeof rfSignalSchema>;

/** Direction belongs to the path: signal comes in on an `in` port and leaves on an `out` port. */
export const RF_PORT_DIRECTIONS = ['in', 'out'] as const;
export const rfPortDirectionSchema = z.enum(RF_PORT_DIRECTIONS);

/** What an output port is for. A tap's `drop` ports feed only drops; `through` continues the line. */
export const RF_PORT_ROLES = ['main', 'through', 'drop', 'tap_leg', 'output', 'pon', 'video', 'common', 'power'] as const;
export const rfPortRoleSchema = z.enum(RF_PORT_ROLES);
export type RfPortRole = z.infer<typeof rfPortRoleSchema>;

export const rfPortSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().trim().min(1).max(40),
  direction: rfPortDirectionSchema,
  signal: rfSignalSchema,
  role: rfPortRoleSchema.optional(),
  /** Loss from the element's input to this output, as entered (tap value on a drop port, through loss on OUT). */
  lossDb: z.number().min(0).max(60).optional(),
  /** An input that may stay empty, such as the PON input of a combining WDM. */
  optional: z.boolean().optional(),
});
export type RfPort = z.infer<typeof rfPortSchema>;

export const RF_ELEMENT_STATUSES = ['planned', 'built', 'verified', 'unknown'] as const;
export const rfElementStatusSchema = z.enum(RF_ELEMENT_STATUSES);

export const RF_POWER_FEEDS = ['coax', 'local', 'unknown'] as const;
export const rfPowerFeedSchema = z.enum(RF_POWER_FEEDS);

export const rfHistorySchema = z.object({
  at: z.string(),
  by: z.string().optional(),
  action: z.string().min(1).max(60),
  details: z.string().max(500),
});

export const rfElementSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  kind: rfElementKindSchema,
  status: rfElementStatusSchema,
  /** The map pin it sits at (a headend room, a pole box). Many elements may share one pin. */
  siteEquipmentId: z.string().min(1).optional(),
  /** Set top box or cable modem: the customer it belongs to. */
  customerId: z.string().min(1).optional(),
  ports: z.array(rfPortSchema).max(40),
  /** Nodes and mini-nodes: powered or passive, as recorded. Never assumed. */
  powered: z.boolean().optional(),
  /** Powered elements: power over the coax or from a local supply. */
  powerFeed: rfPowerFeedSchema.optional(),
  /** Passive elements: whether AC on the coax passes through. */
  passesPower: z.boolean().optional(),
  /** Amplifier forward gain at the high reference frequency, as entered. */
  gainDb: z.number().min(0).max(70).optional(),
  /** Output at the high frequency minus output at the low frequency, as entered. */
  tiltDb: z.number().min(-10).max(30).optional(),
  /** Node or receiver: RF output in dBµV at the optical input below, from its datasheet. */
  ratedOutputDbuv: z.number().min(40).max(130).optional(),
  ratedAtInputDbm: z.number().min(-30).max(15).optional(),
  /** Optical transmitter wavelength, as recorded. */
  wavelengthNm: z.number().int().min(1200).max(1700).optional(),
  /** EDFA: a plain CATV EDFA cannot pass PON light; a WDM EDFA has a pass port. */
  edfaKind: z.enum(['plain', 'wdm']).optional(),
  /** WDM: combine video and PON onto one fiber, or separate them again. */
  wdmRole: z.enum(['combine', 'separate']).optional(),
  /** Where the gain, tilt and losses came from (datasheet, design sheet, set on site). */
  valuesSource: z.string().trim().max(200).optional(),
  vendor: z.string().trim().max(80).optional(),
  model: z.string().trim().max(80).optional(),
  /** Exactly as on the label. Never generated. */
  serialNumber: z.string().trim().max(64).optional(),
  docsisVersion: z.enum(['2.0', '3.0', '3.1', '4.0', 'unknown']).optional(),
  notes: z.string().max(500).optional(),
  createdAt: z.string(),
  history: z.array(rfHistorySchema).optional(),
});
export type RfElement = z.infer<typeof rfElementSchema>;

export const RF_LINK_MEDIA = ['coax', 'fiber', 'jumper', 'power'] as const;
export const rfLinkMediumSchema = z.enum(RF_LINK_MEDIA);
export type RfLinkMedium = z.infer<typeof rfLinkMediumSchema>;

/** Where a coax length came from. They measure different things and are never merged. */
export const RF_LENGTH_SOURCES = ['drawn', 'sheath', 'estimate'] as const;
export const rfLengthSourceSchema = z.enum(RF_LENGTH_SOURCES);

export const rfPortRefSchema = z.object({ elementId: z.string().min(1), portId: z.string().min(1) });
export type RfPortRef = z.infer<typeof rfPortRefSchema>;

export const rfLinkSchema = z.object({
  id: z.string().min(1),
  from: rfPortRefSchema,
  to: rfPortRefSchema,
  medium: rfLinkMediumSchema,
  /** Coax type key, such as "RG6" or "P3 500". Its loss comes from settings. */
  coaxType: z.string().trim().max(40).optional(),
  lengthM: z.number().min(0).max(50000).optional(),
  lengthSource: rfLengthSourceSchema.optional(),
  /** The drawn cable record this link runs in (a coax or fiber cable on the map). */
  cableId: z.string().min(1).optional(),
  /** Fiber links: the fiber number in that cable. */
  fiberNumber: z.number().int().min(1).max(10000).optional(),
  /** Fiber links: wavelengths on this fiber, such as [1550] or [1550, 1490, 1310] when shared with PON. */
  wavelengthsNm: z.array(z.number().int().min(1200).max(1700)).max(8).optional(),
  status: z.enum(['active', 'removed']),
  removedAt: z.string().optional(),
  removedReason: z.string().max(300).optional(),
  createdAt: z.string(),
  createdBy: z.string().optional(),
  history: z.array(rfHistorySchema).optional(),
});
export type RfLink = z.infer<typeof rfLinkSchema>;

export const RF_LEVEL_UNITS = ['dBuV', 'dBmV', 'dBm'] as const;
export const rfLevelUnitSchema = z.enum(RF_LEVEL_UNITS);
export type RfLevelUnit = z.infer<typeof rfLevelUnitSchema>;

export const rfLevelSchema = z.object({
  id: z.string().min(1),
  elementId: z.string().min(1),
  portId: z.string().min(1),
  /** Exactly as read, in `unit`. */
  value: z.number().min(-80).max(160),
  unit: rfLevelUnitSchema,
  /** designed, calculated, field_measured or device_reported. */
  origin: rxSourceSchema,
  /** RF levels: the frequency read. Optical levels (dBm) have none. */
  frequencyMhz: z.number().min(1).max(3000).optional(),
  channel: z.string().trim().max(40).optional(),
  /** Read at a test point that is this many dB below the port. The real level is value + offset. */
  testPointOffsetDb: z.number().min(0).max(40).optional(),
  merDb: z.number().min(0).max(60).optional(),
  ber: z.string().trim().max(20).optional(),
  measuredAt: z.string().optional(),
  instrument: z.string().trim().max(80).optional(),
  technician: z.string().trim().max(80).optional(),
  /** Photo of the meter display. */
  photoId: z.string().min(1).optional(),
  /** Device reported or designed: where it came from (design sheet, EDFA web page). */
  source: z.string().trim().max(200).optional(),
  note: z.string().max(300).optional(),
  createdAt: z.string(),
  createdBy: z.string().optional(),
});
export type RfLevel = z.infer<typeof rfLevelSchema>;
