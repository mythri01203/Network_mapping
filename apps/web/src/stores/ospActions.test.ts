import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { KmlReadError, readKmlText } from '../lib/kmlImport';
import { useConfirmStore } from './confirmStore';
import { useNetworkStore } from './networkStore';
import { addAttachments, addSpan, placeEquipmentChecked } from './ospActions';
import { useToastStore } from './toastStore';
import { useUiStore } from './uiStore';

const pristine = useNetworkStore.getState();
const pole = { name: 'Pole-90', type: 'Telecom Pole' as const, category: 'Supporting Infrastructure' as const, lat: 12.95, lng: 77.61 };

beforeEach(() => {
  localStorage.clear();
  useNetworkStore.setState(pristine, true);
  useUiStore.setState({ selectedObject: null });
  useToastStore.setState({ toasts: [] });
  useConfirmStore.setState({ pending: null });
});

afterEach(() => useConfirmStore.setState({ pending: null }));

/** Waits for the "same one?" question, then answers it. */
async function answer(addNew: boolean) {
  for (let i = 0; i < 20 && !useConfirmStore.getState().pending; i += 1) await Promise.resolve();
  const pending = useConfirmStore.getState().pending;
  useConfirmStore.getState().respond(addNew);
  return pending;
}

describe('"same one?" before placing on the engineer map', () => {
  it('places without asking when nothing of the same kind is near', async () => {
    const created = await placeEquipmentChecked(pole);
    expect(created?.type).toBe('Telecom Pole');
    expect(useConfirmStore.getState().pending).toBeNull();
  });

  it('asks, and "same one" adds nothing and shows the existing pole', async () => {
    const first = await placeEquipmentChecked(pole);
    const count = useNetworkStore.getState().equipment.length;
    const second = placeEquipmentChecked({ ...pole, name: 'Pole-91', lat: 12.95002 });
    const question = await answer(false);
    expect(question?.title).toBe('Is this the same one?');
    expect(question?.message).toMatch(/Pole-90/);
    expect(await second).toBeNull();
    expect(useNetworkStore.getState().equipment).toHaveLength(count);
    expect(useUiStore.getState().selectedObject).toMatchObject({ type: 'equipment', data: { id: first?.id } });
  });

  it('never blocks: "add a new one" adds it and writes the choice to the audit trail', async () => {
    await placeEquipmentChecked(pole);
    const second = placeEquipmentChecked({ ...pole, name: 'Pole-91', lat: 12.95002 });
    await answer(true);
    const created = await second;
    expect(created?.name).toBe('Pole-91');
    expect(useNetworkStore.getState().auditLogs[0]).toMatchObject({ action: 'POSSIBLE_DUPLICATE_KEPT', assetId: created?.id });
  });
});

describe('spans and attachments through the store', () => {
  it('records a span and a cable on it, with undo covering both', async () => {
    const a = await placeEquipmentChecked(pole);
    const b = await placeEquipmentChecked({ ...pole, name: 'Pole-92', lat: 12.9505 });
    const span = addSpan({ fromStructureId: a!.id, toStructureId: b!.id, status: 'built', basis: 'office_drawn' });
    expect(span).not.toBeNull();
    const cableId = useNetworkStore.getState().cables[0].id;
    expect(addAttachments([{ cableId, spanId: span!.id, status: 'built', basis: 'office_confirmed' }])).toBe(1);
    expect(useNetworkStore.getState().attachments).toHaveLength(1);
    useNetworkStore.getState().undo();
    expect(useNetworkStore.getState().attachments).toHaveLength(0);
    expect(useNetworkStore.getState().spans).toHaveLength(1);
  });
});

describe('reading KML and KMZ files', () => {
  const kml = '<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document/></kml>';

  it('reads a plain KML as text', async () => {
    expect(await readKmlText(new File([kml], 'route.kml'))).toBe(kml);
  });

  it('takes doc.kml from a KMZ, else the first KML inside', async () => {
    const kmz = zipSync({ 'files/other.kml': strToU8('<kml>other</kml>'), 'doc.kml': strToU8(kml), 'icon.png': new Uint8Array([1, 2]) });
    expect(await readKmlText(new File([kmz], 'route.kmz'))).toBe(kml);
    const nested = zipSync({ 'a/route.kml': strToU8('<kml>nested</kml>') });
    expect(await readKmlText(new File([nested], 'r.kmz'))).toBe('<kml>nested</kml>');
  });

  it('says plainly when a KMZ holds no KML', async () => {
    const empty = zipSync({ 'icon.png': new Uint8Array([1]) });
    await expect(readKmlText(new File([empty], 'r.kmz'))).rejects.toBeInstanceOf(KmlReadError);
  });
});
