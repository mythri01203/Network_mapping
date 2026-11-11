import { strToU8, zipSync } from 'fflate';

import { type CellValue, isoDate, type NetworkSnapshot, roleHidesPersonalData } from '@fibergis/shared';

import { buildNetworkKml, type KmlSource } from '../../lib/kml';
import { downloadXlsx, type XlsxSheet } from '../../lib/xlsxExport';
import { currentAccount, loginIsOn, mayDo } from '../../stores/authStore';
import { logAudit } from '../../stores/networkActions';
import { getNetworkSnapshot } from '../../stores/networkStore';
import { showToast } from '../../stores/toastStore';
import { TABLE_LAYERS, tableContext } from '../table/tableLayers';

/**
 * Network mapping Phase 21: the network saved to a file as KML (now with ducts, spans and
 * buildings), KMZ (the same KML zipped) or Excel. Every export needs the export right, and uses the
 * records this device holds, which the server has already cut down for the person's role (Phase 12:
 * customer names, addresses, house positions and mobiles show "Hidden for your role", and a hidden
 * house position is left out of the map files). A blank Excel cell means not recorded.
 */

/** The attribute table layers that make the Excel sheets: every kind of record once, no subsets. */
export const EXCEL_LAYER_IDS = ['equipment', 'cables', 'customers', 'closures', 'splices', 'splitters', 'ducts', 'spans', 'slackLoops', 'buildings', 'onts', 'faults', 'zones'] as const;

const cell = (v: CellValue): string | number | null => (v === undefined ? null : typeof v === 'boolean' ? (v ? 'yes' : 'no') : v);

/** The workbook: a first sheet saying what the file is, then one sheet per kind of record, every column. */
export function networkWorkbook(data: NetworkSnapshot, info: { exportedAt: Date; exportedBy: string; hiddenForRole: boolean }): XlsxSheet[] {
  const ctx = tableContext(data);
  const sheets: XlsxSheet[] = [];
  const counts: { label: string; rows: number }[] = [];
  for (const id of EXCEL_LAYER_IDS) {
    const layer = TABLE_LAYERS.find((l) => l.id === id);
    if (!layer) continue;
    const rows = layer.rows(data);
    counts.push({ label: layer.label, rows: rows.length });
    sheets.push({
      name: layer.label,
      columns: layer.columns.map((c) => ({ key: c.key, label: c.label })),
      rows: rows.map((r) => Object.fromEntries(layer.columns.map((c) => [c.key, cell(c.get(r, ctx))]))),
    });
  }
  const about: XlsxSheet = {
    name: 'About this file',
    columns: [
      { key: 'what', label: 'What' },
      { key: 'value', label: 'Value' },
    ],
    rows: [
      { what: 'Saved from', value: 'FiberGIS' },
      { what: 'Saved at', value: info.exportedAt.toISOString() },
      { what: 'Saved by', value: info.exportedBy },
      { what: 'Blank cells', value: 'Not recorded. Nothing is filled in.' },
      ...(info.hiddenForRole ? [{ what: 'Customer details', value: 'Some are hidden for your role and say "Hidden for your role".' }] : []),
      ...counts.map((c) => ({ what: c.label, value: c.rows })),
    ],
  };
  return [about, ...sheets];
}

/** The KML for the network this device holds, with ducts, spans and buildings. */
export function networkKmlSource(data: NetworkSnapshot): KmlSource {
  return { equipment: data.equipment, cables: data.cables, customers: data.customers, ducts: data.ducts, spans: data.spans, buildings: data.buildings };
}

/** A KMZ: the KML as doc.kml in a zip, as Google Earth writes it. */
export function buildNetworkKmz(source: KmlSource): Uint8Array {
  return zipSync({ 'doc.kml': strToU8(buildNetworkKml(source)) }, { level: 6 });
}

function exportAllowed(): boolean {
  if (mayDo('export')) return true;
  showToast('error', 'Not allowed for your account', 'Your account cannot save the network to a file. Ask the office.');
  return false;
}

const whoIsExporting = () => (loginIsOn() ? (currentAccount()?.displayName ?? 'Not recorded') : 'Setup mode (login off)');

function downloadBytes(bytes: Uint8Array, mimeType: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportNetworkKmz(): boolean {
  if (!exportAllowed()) return false;
  const data = getNetworkSnapshot();
  downloadBytes(buildNetworkKmz(networkKmlSource(data)), 'application/vnd.google-earth.kmz', `fiber_gis_network_${isoDate()}.kmz`);
  showToast('success', 'KMZ saved', `${data.equipment.length} items, ${data.cables.length} cables, ${data.ducts.length} ducts, ${data.spans.length} spans and ${data.buildings.length} buildings. Opens in Google Earth.`);
  logAudit('NETWORK_EXPORTED', `Saved the network as KMZ (${data.equipment.length} items, ${data.cables.length} cables)`, 'SYSTEM', 'System');
  return true;
}

export async function exportNetworkExcel(): Promise<boolean> {
  if (!exportAllowed()) return false;
  const data = getNetworkSnapshot();
  const account = loginIsOn() ? currentAccount() : null;
  const sheets = networkWorkbook(data, { exportedAt: new Date(), exportedBy: whoIsExporting(), hiddenForRole: roleHidesPersonalData(account ? { role: account.role, displayName: account.displayName } : null) });
  try {
    await downloadXlsx(sheets, `fiber_gis_network_${isoDate()}.xlsx`);
  } catch {
    showToast('error', 'Excel file not saved', 'The spreadsheet could not be made on this device. Try again, or save as CSV from the table.');
    return false;
  }
  showToast('success', 'Excel file saved', `${sheets.length - 1} sheets, one per kind of record. A blank cell means not recorded.`);
  logAudit('NETWORK_EXPORTED', `Saved the network as Excel (${sheets.length - 1} sheets)`, 'SYSTEM', 'System');
  return true;
}
