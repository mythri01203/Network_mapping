import type { PonTechnology } from '@fibergis/shared';

export interface PonTechnologySpec {
  standard: string;
  rate: string;
  wavelengths: string;
}

/** Reference line rates and wavelengths per PON standard (downstream / upstream). */
export const PON_TECHNOLOGY_SPECS: Record<PonTechnology, PonTechnologySpec> = {
  GPON: { standard: 'ITU-T G.984', rate: '2.488 / 1.244 Gbps', wavelengths: '1490 / 1310 nm' },
  EPON: { standard: 'IEEE 802.3ah', rate: '1.25 Gbps symmetric', wavelengths: '1490 / 1310 nm' },
  'Combo PON': {
    standard: 'GPON + XGS-PON',
    rate: 'Both on one port',
    wavelengths: '1490 + 1577 / 1310 + 1270 nm',
  },
  'XG-PON': { standard: 'ITU-T G.987', rate: '9.953 / 2.488 Gbps', wavelengths: '1577 / 1270 nm' },
  'XGS-PON': { standard: 'ITU-T G.9807.1', rate: '9.953 Gbps symmetric', wavelengths: '1577 / 1270 nm' },
  '10G-EPON': { standard: 'IEEE 802.3av', rate: '10.3 Gbps symmetric', wavelengths: '1577 / 1270 nm' },
};
