import { useState } from 'react';
import { Download, FileSpreadsheet, Globe } from 'lucide-react';

import { Button } from '../../components/ui';
import { useMayDo } from '../../stores/authStore';
import { exportKML } from '../../stores/networkActions';
import { exportNetworkExcel, exportNetworkKmz } from './networkExport';

/** Network mapping Phase 21: the network saved to a file (KML, KMZ, Excel). Needs the export right. */
export function ExportPanel() {
  const mayExport = useMayDo('export');
  const [busy, setBusy] = useState(false);
  if (!mayExport) {
    return <p className="py-6 text-center text-[13px] text-slate-600">Your account cannot save the network to a file. Ask the office.</p>;
  }
  const row = 'flex w-full items-center justify-start gap-2 min-h-[44px]';
  return (
    <div className="space-y-3" data-testid="export-panel">
      <p className="text-[13px] text-slate-700">Save the whole network to a file. Customer details are saved only as your account may see them.</p>
      <Button className={row} onClick={exportKML} data-testid="export-kml">
        <Globe size={16} /> Google Earth file (.kml)
      </Button>
      <Button className={row} onClick={() => exportNetworkKmz()} data-testid="export-kmz">
        <Download size={16} /> Google Earth file, zipped (.kmz)
      </Button>
      <Button
        className={row}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await exportNetworkExcel();
          setBusy(false);
        }}
        data-testid="export-xlsx"
      >
        <FileSpreadsheet size={16} /> {busy ? 'Making the Excel file…' : 'Excel spreadsheet (.xlsx), one sheet per kind of item'}
      </Button>
      <p className="text-[12px] text-slate-500">
        The map files hold items, cables, ducts, spans, buildings and customers with a recorded position. The Excel file has every column of the table view; a blank cell means not
        recorded.
      </p>
    </div>
  );
}
