import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildApp } from './app';
import { loadConfig } from './config';
import { seedSampleNetwork } from './db/seed';
import { TenantRegistry } from './db/tenants';
import { type ScheduledBackups, startScheduledBackups } from './lib/scheduledBackups';

// Private settings (such as SARVAM_API_KEY) from apps/server/.env, which git ignores. Settings
// already in the environment win. The file's contents are never logged.
const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const config = loadConfig();

// Phase 23b: the organisations on this server. The database at DATABASE_PATH is the first one, used
// where it is; on the first start after the upgrade it is only registered in control.db (nothing in
// it is copied, moved or changed). Messages wait until the server's log is ready.
const startupNotes: { level: 'info' | 'warn'; msg: string }[] = [];
const tenants = TenantRegistry.open({
  controlPath: config.controlDatabasePath,
  organisationsDir: config.organisationsDir,
  host: { name: config.organisationName, databasePath: config.databasePath, photosDir: config.photosDir, voiceDir: config.voiceDir, backupsDir: config.backupsDir },
  log: { info: (msg) => startupNotes.push({ level: 'info', msg }), warn: (msg) => startupNotes.push({ level: 'warn', msg }) },
});
const repository = tenants.host().repository;
const app = await buildApp({ config, tenants });
for (const note of startupNotes) app.log[note.level](note.msg);
if (tenants.all().length > 1) app.log.info(`Organisations: ${tenants.all().length} on this server (${tenants.all().filter((t) => t.status !== 'active').length} switched off)`);

// The sample network goes only into a brand-new first organisation; added organisations start empty.
if (config.seedSampleData && (await seedSampleNetwork(repository))) {
  app.log.info('New database: loaded the sample network');
}

app.log.info(config.sarvamApiKey ? `Voice lessons: Sarvam set up (${config.sarvamModel})` : 'Voice lessons: not set up (no SARVAM_API_KEY)');

// Plain warnings at start, so a risky setting is seen before it matters.
if (!tenants.hasAccounts() && !config.authRequired) {
  app.log.warn('Login is off: no account exists yet. Only this computer (http://localhost) can use FiberGIS until the first administrator is made in Administration → Users and roles.');
}
if (config.trustProxy === true) {
  app.log.warn('TRUST_PROXY=true trusts any X-Forwarded-For header. Use the proxy address or hop count (e.g. TRUST_PROXY=127.0.0.1) unless port ' + config.port + ' is reachable only through the proxy.');
}
if (!config.https && config.cookieSecure !== 'true' && config.trustProxy === false && !['127.0.0.1', 'localhost', '::1'].includes(config.host)) {
  app.log.warn('Serving plain http to the network: passwords and session cookies can be read on the way. Put https in front (see docs/DEPLOYMENT_GUIDE.md).');
}

// Phase 24: scheduled backups, off unless BACKUP_EVERY_HOURS is set. Phase 23b: one schedule per
// organisation, each into its own backups folder (organisations added later get one too).
const scheduledBackups: ScheduledBackups[] = [];
tenants.onOpen((tenant) => {
  scheduledBackups.push(
    startScheduledBackups({
      repository: tenant.repository,
      everyHours: config.backupEveryHours,
      keep: config.backupKeep,
      backupsDir: tenant.backupsDir,
      photosDir: tenant.photosDir,
      log: {
        info: (obj, msg) => app.log.info({ ...obj, organisationId: tenant.id }, msg),
        error: (obj, msg) => app.log.error({ ...obj, organisationId: tenant.id }, msg),
      },
    }),
  );
});
if (config.backupEveryHours > 0) app.log.info(`Scheduled backups: every ${config.backupEveryHours} hour(s) into each organisation's backups folder (first organisation: ${config.backupsDir}), newest ${config.backupKeep} kept`);

let closing = false;
const shutdown = async (signal: NodeJS.Signals) => {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'Shutting down');
  for (const schedule of scheduledBackups) schedule.stop();
  await app.close();
  await tenants.close();
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  await tenants.close();
  process.exit(1);
}
