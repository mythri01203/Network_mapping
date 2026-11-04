import { createSampleNetwork } from '@fibergis/shared/sample';
import type { NetworkRepository } from './repository';

/**
 * Loads the demo network into a database that has never been written to. Revision 0 means "new",
 * so a user who deliberately empties their network does not get the demo data back on restart.
 */
export async function seedSampleNetwork(repository: NetworkRepository): Promise<boolean> {
  if ((await repository.getRevision()) > 0) return false;
  await repository.replaceCollections(createSampleNetwork());
  return true;
}
