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

// Plain warnings at start, so a risky setting is seen before it matters.
if (!repository.auth.hasAccounts() && !config.authRequired) {
  app.log.warn('Login is off: no account exists yet. Only this computer (http://localhost) can use FiberGIS until the first administrator is made in Administration → Users and roles.');
}
if (config.trustProxy === true) {
  app.log.warn('TRUST_PROXY=true trusts any X-Forwarded-For header. Use the proxy address or hop count (e.g. TRUST_PROXY=127.0.0.1) unless port ' + config.port + ' is reachable only through the proxy.');
}
if (!config.https && config.cookieSecure !== 'true' && config.trustProxy === false && !['127.0.0.1', 'localhost', '::1'].includes(config.host)) {
  app.log.warn('Serving plain http to the network: passwords and session cookies can be read on the way. Put https in front (see docs/DEPLOYMENT_GUIDE.md).');
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
