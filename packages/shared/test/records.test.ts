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

  it('makes up no boundary, area or counts for a zone created without them', () => {
    const result = createZone(smallNetwork(), { name: 'North', areaCode: 'N1' }, ctx);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.id).toMatch(/^ZONE-[0-9A-HJKMNP-TV-Z]{10}$/);
    expect(result.value).toMatchObject({ status: 'Expansion', coverageSqKm: 0, fatCount: 0, feederCableCount: 0 });
    expect(result.value.boundaryCoords).toEqual([]);
  });

  it('keeps a boundary that was drawn', () => {
    const boundary: [number, number][] = [
      [17.4, 78.4],
      [17.41, 78.4],
      [17.41, 78.41],
    ];
    const result = createZone(smallNetwork(), { name: 'North', areaCode: 'N1', boundaryCoords: boundary }, ctx);
    expect(result.ok && result.value.boundaryCoords).toEqual(boundary);
  });

  it('rejects duplicate ids and supports update and delete', () => {
    const data = smallNetwork();
    const created = createZone(data, { name: 'North', areaCode: 'N1' }, ctx);
    if (!created.ok) throw new Error(created.error.message);
    const withZone = applyPatch(data, created.patch);
    expect(createZone(withZone, { id: created.value.id.toLowerCase(), name: 'Again', areaCode: 'N2' }, ctx)).toMatchObject({
      ok: false,
      error: { title: 'Duplicate Zone ID' },
    });

    const updated = updateZone(withZone, { ...created.value, status: 'Operational' });
    if (!updated.ok) throw new Error(updated.error.message);
    expect(applyPatch(withZone, updated.patch).zones[0].status).toBe('Operational');

    const removed = deleteZone(withZone, created.value.id);
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

  it('prepends new documents with the acting user and a random id', () => {
    const data = emptyNetwork();
    const first = createDocument(data, { title: 'OLT manual', category: 'Datasheet' }, ctx);
    if (!first.ok) throw new Error(first.error.message);
    expect(first.value.id).toMatch(/^DOC-[0-9A-HJKMNP-TV-Z]{10}$/);
    expect(first.value).toMatchObject({ uploadedBy: 'Admin User', uploadDate: '2026-11-04' });

    const withFirst = applyPatch(data, first.patch);
    const second = createDocument(withFirst, { title: 'Splice plan', category: 'Datasheet' }, ctx);
    if (!second.ok) throw new Error(second.error.message);
    const withBoth = applyPatch(withFirst, second.patch);
    if (!second.ok) throw new Error('second document');
    expect(withBoth.documents.map((d) => d.id)).toEqual([second.value.id, first.value.id]);
    expect(createDocument(withBoth, { id: first.value.id.toLowerCase(), title: 'Dup', category: 'Datasheet' }, ctx)).toMatchObject({
      ok: false,
      error: { title: 'Duplicate Document ID' },
    });

    const removed = deleteDocument(withBoth, first.value.id);
    if (!removed.ok) throw new Error(removed.error.message);
    expect(applyPatch(withBoth, removed.patch).documents.map((d) => d.id)).toEqual([second.value.id]);
  });
});
