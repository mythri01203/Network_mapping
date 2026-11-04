import { buildApp } from './app';
import { loadConfig } from './config';
import { seedSampleNetwork } from './db/seed';
import { SqliteNetworkRepository } from './db/sqliteRepository';

const config = loadConfig();
const repository = new SqliteNetworkRepository(config.databasePath);
const app = await buildApp({ config, repository });

if (config.seedSampleData && (await seedSampleNetwork(repository))) {
  app.log.info('New database: loaded the sample network');
}

let closing = false;
const shutdown = async (signal: NodeJS.Signals) => {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'Shutting down');
  await app.close();
  await repository.close();
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  await repository.close();
  process.exit(1);
}
