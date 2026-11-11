import { useState } from 'react';
import { Download, FileUp, History } from 'lucide-react';

import { Modal, Tabs } from '../../components/ui';
import { useUiStore } from '../../stores/uiStore';
import { ExportPanel } from './ExportPanel';
import { ImportHistoryPanel } from './ImportHistoryPanel';
import { ImportWizard } from './ImportWizard';

/**
 * Import and export of map files (KML and KMZ since Phase 3; GeoJSON, CSV, Shapefile, import
 * history with undo, KMZ and Excel since network mapping Phase 21). The modal key stays
 * `kmlImport` so every existing menu item still opens it.
 */
export function KmlImportModal() {
  const open = useUiStore((s) => s.modals.kmlImport);
  const setModalOpen = useUiStore((s) => s.setModalOpen);
  if (!open) return null;
  return <ImportExport onClose={() => setModalOpen('kmlImport', false)} />;
}

type Tab = 'import' | 'history' | 'export';

function ImportExport({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('import');
  // A fresh wizard each time the import tab is opened again.
  const [wizardKey, setWizardKey] = useState(0);
  return (
    <Modal open onClose={onClose} title="Import or export a map file" icon={FileUp} size="xl">
      <div className="space-y-4">
        <Tabs<Tab>
          variant="segmented"
          fullWidth
          value={tab}
          onChange={(next) => {
            if (next === 'import' && tab !== 'import') setWizardKey((k) => k + 1);
            setTab(next);
          }}
          items={[
            { id: 'import', label: 'Import', icon: FileUp },
            { id: 'history', label: 'Past imports', icon: History },
            { id: 'export', label: 'Save to a file', icon: Download },
          ]}
        />
        {tab === 'import' && <ImportWizard key={wizardKey} onClose={onClose} />}
        {tab === 'history' && <ImportHistoryPanel />}
        {tab === 'export' && <ExportPanel />}
      </div>
    </Modal>
  );
}
