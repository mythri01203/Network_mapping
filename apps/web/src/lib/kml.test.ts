import { describe, expect, it } from 'vitest';

import { createSampleNetwork } from '@fibergis/shared/sample';

import { buildNetworkKml } from './kml';

describe('buildNetworkKml', () => {
  const sample = createSampleNetwork();

  it('emits one placemark per asset with lng,lat ordering', () => {
    const kml = buildNetworkKml(sample);
    const routable = sample.cables.filter((c) => c.coordinates.length >= 2);
    expect(kml.match(/<Placemark>/g)).toHaveLength(sample.equipment.length + routable.length + sample.customers.length);
    const [first] = sample.equipment;
    expect(kml).toContain(`<coordinates>${first.lng},${first.lat},0</coordinates>`);
    expect(kml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });

  it('escapes user-entered text', () => {
    const equipment = [{ ...sample.equipment[0], name: 'Hub <A&B> "north"' }];
    const kml = buildNetworkKml({ equipment, cables: [], customers: [] });
    expect(kml).toContain('Hub &lt;A&amp;B&gt; &quot;north&quot;');
    expect(kml).not.toContain('<A&B>');
  });
});
