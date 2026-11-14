import './index.css';
// The light or dark look chosen on this device, set before anything is drawn.
import './stores/themeStore';

import { startOfficeCache } from './lib/officeCache';

// Phase 19: the offline copy of the network lives in IndexedDB. It is read into memory first, so
// the network store and the sync engine (in boot.tsx) start from it. If IndexedDB cannot open, the
// app keeps using localStorage as before.
void startOfficeCache()
  .catch(() => undefined)
  .then(() => import('./boot'));
