import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { type Cable, coreCrossSection } from '@fibergis/shared';

import { CoreCrossSection } from './CoreCrossSection';
import { layoutCrossSection, markerFor, VIEW_SIZE } from './crossSectionLayout';

const cable = (extra: Partial<Cable>): Cable => ({
  id: 'C-1',
  name: 'C-1',
  type: 'Distribution Fiber',
  fiberCount: 24,
  lengthMeters: 100,
  owner: 'Test',
  installationDate: '2026-01-01',
  status: 'Active',
  coordinates: [],
  cores: [],
  cableCategory: 'Fiber',
  ...extra,
});

const inside = (x: number, y: number, r: number, cx: number, cy: number, R: number) => Math.hypot(x - cx, y - cy) + r <= R + 0.01;

describe('cable cross-section layout', () => {
  it('keeps every fiber inside its tube and every tube inside the cable', () => {
    for (const extra of [
      { fibersPerTube: 12 },
      { fiberCount: 96, fibersPerTube: 12 },
      { fiberCount: 288, fibersPerTube: 12 },
      { fiberCount: 18, tubes: [{ number: 1, fiberCount: 12 }, { number: 2, fiberCount: 6 }] },
      { fiberCount: 2 },
      { fiberCount: 96 },
    ] as Partial<Cable>[]) {
      const tubes = layoutCrossSection(coreCrossSection(cable(extra)));
      expect(tubes.length).toBeGreaterThan(0);
      for (const t of tubes) {
        expect(inside(t.x, t.y, t.r, VIEW_SIZE / 2, VIEW_SIZE / 2, VIEW_SIZE / 2)).toBe(true);
        for (const f of t.fibers) expect(inside(f.x, f.y, f.r, t.x, t.y, t.r)).toBe(true);
      }
      expect(tubes.flatMap((t) => t.fibers)).toHaveLength(extra.fiberCount ?? 24);
    }
  });

  it('gives each state a shape, so the state is never colour alone', () => {
    expect(markerFor('Faulty')).toBe('cross');
    expect(markerFor('Damaged')).toBe('cross');
    expect(markerFor('Retired')).toBe('slash');
    expect(markerFor('Reserved')).toBe('ring');
    expect(markerFor('In Use')).toBe('dot');
    expect(markerFor('Available')).toBe('none');
  });

  it('draws no fiber colour when the scheme is not known, and numbers instead', () => {
    const html = renderToStaticMarkup(<CoreCrossSection section={coreCrossSection(cable({ fibersPerTube: 12 }))} />);
    expect(html).toContain('Colours not known, shown by number');
    expect(html).not.toContain('#0284c7');
    expect(html).toMatch(/>13<\/text>/);
  });

  it('draws scheme colours and a mark for a faulty fiber', () => {
    const html = renderToStaticMarkup(
      <CoreCrossSection section={coreCrossSection(cable({ fibersPerTube: 12, colorScheme: 'tia-598', cores: [{ coreNumber: 2, status: 'Faulty' }] }))} />,
    );
    expect(html).toContain('#0284c7');
    const fiber2 = html.split('data-testid="xs-fiber-2"')[1].split('data-testid="xs-fiber-3"')[0];
    expect(fiber2).toContain('data-status="Faulty"');
    expect(fiber2).toContain('<g><line');
    const fiber1 = html.split('data-testid="xs-fiber-1"')[1].split('data-testid="xs-fiber-2"')[0];
    expect(fiber1).not.toContain('<line');
  });

  it('says when the tubes are not recorded', () => {
    const html = renderToStaticMarkup(<CoreCrossSection section={coreCrossSection(cable({}))} />);
    expect(html).toContain('Tubes not recorded');
    expect(html).toContain('data-testid="xs-tube-all"');
  });
});
