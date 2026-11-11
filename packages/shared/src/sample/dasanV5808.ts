/**
 * DASAN (DZS) V5808 GPON OLT, as used by the Vijayawada demo and the DASAN poller.
 *
 * The addressing below follows DASAN NOS as published in third-party guides. Check it against a
 * real `show onu info` from your OLT before relying on it: FiberGIS matches monitoring rows to ONTs
 * only on the exact text, so a different format just shows as "not matched", never on a customer.
 */
export const DASAN_V5808 = {
  vendor: 'DASAN',
  model: 'V5808',
  ponPorts: 8,
  rackUnits: 1,
  ontModel: 'H660GM',
  /** Sample serial vendor id. Serials are written vendor id + lower-case hex, as `show onu info` prints them. */
  ontSerialPrefix: 'DSNW',
  /** DZS datasheet and reseller listing. ONUs per port and the SFP optics class were not found in a public source. */
  summary: '1U GPON OLT, 8 GPON ports, 4 x 1/10GbE SFP+ and 4 x 1GbE RJ45 uplinks.',
  /** PON port as DASAN NOS names it, e.g. "gpon-olt 1". */
  ponAddress: (pon: number) => `gpon-olt ${pon}`,
  /**
   * ONU as "<OLT>/<ONU>", the two numbers DASAN NOS lists in `show onu info` (and the two SNMP index
   * parts of SLE-GPON-MIB). The poller builds the same text, so demo ONTs and polled rows match.
   */
  onuAddress: (pon: number, onuId: number) => `${pon}/${onuId}`,
};
