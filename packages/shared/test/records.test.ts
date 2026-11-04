import { describe, expect, it } from 'vitest';

import { applyPatch } from '../src/domain/command';
import { createDocument, createZone, deleteDocument, deleteZone, updateZone } from '../src/domain/records';
import { emptyNetwork, NOW, smallNetwork } from './fixtures';

const ctx = { now: NOW, actor: 'Admin User' };

describe('zones', () => {
  it('requires a name and area code', () => {
    expect(createZone(emptyNetwork(), { name: ' ', areaCode: 'A1' }, ctx)).toMatchObject({
      ok: false,
      error: { title: 'Missing Zone Details' },
    });
  });

  it('draws a placeholder boundary around the network anchor', () => {
    const result = createZone(smallNetwork(), { name: 'North', areaCode: 'N1' }, ctx);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toMatchObject({ id: 'ZONE-01', status: 'Expansion', coverageSqKm: 2.5 });
    expect(result.value.boundaryCoords).toHaveLength(4);
    const lats = result.value.boundaryCoords.map(([lat]) => lat);
    expect(Math.min(...lats)).toBeCloseTo(17.4 - 0.0035);
    expect(Math.max(...lats)).toBeCloseTo(17.4 + 0.0035);
  });

  it('rejects duplicate ids and supports update and delete', () => {
    const data = smallNetwork();
    const created = createZone(data, { name: 'North', areaCode: 'N1' }, ctx);
    if (!created.ok) throw new Error(created.error.message);
    const withZone = applyPatch(data, created.patch);
    expect(createZone(withZone, { id: 'zone-01', name: 'Again', areaCode: 'N2' }, ctx)).toMatchObject({
      ok: false,
      error: { title: 'Duplicate Zone ID' },
    });

    const updated = updateZone(withZone, { ...created.value, status: 'Operational' });
    if (!updated.ok) throw new Error(updated.error.message);
    expect(applyPatch(withZone, updated.patch).zones[0].status).toBe('Operational');

    const removed = deleteZone(withZone, 'ZONE-01');
    if (!removed.ok) throw new Error(removed.error.message);
    expect(applyPatch(withZone, removed.patch).zones).toEqual([]);
    expect(deleteZone(withZone, 'ZONE-99')).toMatchObject({ ok: false });
  });
});

describe('documents', () => {
  it('requires a title', () => {
    expect(createDocument(emptyNetwork(), { title: '', category: 'Datasheet' }, ctx)).toMatchObject({
      ok: false,
      error: { title: 'Missing Title' },
    });
  });

  it('prepends new documents with the acting user and a sequential id', () => {
    const data = emptyNetwork();
    const first = createDocument(data, { title: 'OLT manual', category: 'Datasheet' }, ctx);
    if (!first.ok) throw new Error(first.error.message);
    expect(first.value).toMatchObject({ id: 'DOC-001', uploadedBy: 'Admin User', uploadDate: '2026-11-04' });

    const withFirst = applyPatch(data, first.patch);
    const second = createDocument(withFirst, { title: 'Splice plan', category: 'Datasheet' }, ctx);
    if (!second.ok) throw new Error(second.error.message);
    const withBoth = applyPatch(withFirst, second.patch);
    expect(withBoth.documents.map((d) => d.id)).toEqual(['DOC-002', 'DOC-001']);
    expect(createDocument(withBoth, { id: 'doc-001', title: 'Dup', category: 'Datasheet' }, ctx)).toMatchObject({
      ok: false,
      error: { title: 'Duplicate Document ID' },
    });

    const removed = deleteDocument(withBoth, 'DOC-001');
    if (!removed.ok) throw new Error(removed.error.message);
    expect(applyPatch(withBoth, removed.patch).documents.map((d) => d.id)).toEqual(['DOC-002']);
  });
});
