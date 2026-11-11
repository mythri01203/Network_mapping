/**
 * Account help from the server's own computer, for when nobody can log in:
 *
 *   npm run user -w @fibergis/server -- list
 *   npm run user -w @fibergis/server -- reset-password <login name>
 *   npm run user -w @fibergis/server -- organisations
 *   npm run user -w @fibergis/server -- add-vijayawada-demo [organisation name]
 *   npm run user -w @fibergis/server -- remove-vijayawada-demo [organisation name]
 *
 * Uses DATABASE_PATH (and, Phase 23b, CONTROL_DATABASE_PATH and ORGANISATIONS_DIR) like the server,
 * so it finds an account in whichever organisation it belongs to. Prints a temporary password once;
 * it is never stored or logged. Whoever can run this already has the database files, so it adds no
 * new way in.
 */
/* eslint-disable no-console -- a command-line tool: printing to the terminal is its job. */
import { formatLogTimestamp, randomCode } from '@fibergis/shared';
import { createVijayawadaNetwork, VIJAYAWADA_CUSTOMER_COUNT, vijayawadaRecordIds } from '@fibergis/shared/sample';

import { hashPassword, temporaryPassword } from './auth/passwords';
import { loadConfig } from './config';
import { TenantRegistry } from './db/tenants';
import { changeSetGuard } from './lib/linkGuard';

const [command, name] = process.argv.slice(2);
const config = loadConfig();
const tenants = TenantRegistry.open({
  controlPath: config.controlDatabasePath,
  organisationsDir: config.organisationsDir,
  host: { name: config.organisationName, databasePath: config.databasePath, photosDir: config.photosDir, voiceDir: config.voiceDir, backupsDir: config.backupsDir },
  log: { info: (msg) => console.log(msg), warn: (msg) => console.warn(msg) },
});

try {
  if (command === 'list') {
    const all = tenants.all().flatMap((tenant) => tenant.repository.auth.list().map((u) => ({ tenant, u })));
    if (all.length === 0) console.log('No accounts yet: login is off (setup mode).');
    for (const { tenant, u } of all) console.log(`${u.username}\t${u.role}\t${u.active ? 'active' : 'switched off'}\t${u.displayName}\t${tenant.name}`);
  } else if (command === 'organisations') {
    for (const o of tenants.summaries()) console.log(`${o.id}\t${o.status}\t${o.host ? 'first' : ''}\t${o.activeAccounts} account(s)\t${o.name}`);
  } else if (command === 'reset-password' && name) {
    const found = tenants.findLogin(name);
    if (!found) {
      console.error(`No account with the login name "${name}". Run "list" to see them.`);
      process.exitCode = 1;
    } else {
      const { tenant, user } = found;
      const store = tenant.repository.auth;
      const password = temporaryPassword(12);
      store.setPassword(user.id, await hashPassword(password), true);
      if (!user.active) store.update(user.id, { displayName: user.displayName, role: user.role, active: true });
      console.log(`New temporary password for ${user.username} (${tenant.name}): ${password}`);
      console.log('They will be asked to choose their own after logging in. All their sessions were ended.');
      if (tenant.status !== 'active') console.log(`Note: the organisation "${tenant.name}" is switched off, so they cannot log in until it is switched on.`);
    }
  } else if (command === 'add-vijayawada-demo' || command === 'remove-vijayawada-demo') {
    const all = tenants.all();
    const tenant = name ? all.find((t) => t.name.trim().toLowerCase() === name.trim().toLowerCase()) : all[0];
    if (!tenant) {
      console.error(`No organisation called "${name}". Run "organisations" to see them.`);
      process.exitCode = 1;
    } else {
      const { data } = await tenant.repository.getNetwork();
      const existing = vijayawadaRecordIds(data);
      const audit = (action: string, details: string) => ({
        id: `LOG-${randomCode(10)}`,
        timestamp: formatLogTimestamp(new Date()),
        user: 'Server command line',
        role: 'Administrator' as const,
        action,
        details,
        assetId: 'SYSTEM',
        assetType: 'System' as const,
      });
      const options = { actor: { id: null, name: 'Server command line', role: null }, source: 'server' as const };
      if (command === 'add-vijayawada-demo') {
        if ((existing.customers ?? []).length > 0) {
          console.error(`The Vijayawada demo is already in "${tenant.name}" (${existing.customers!.length} demo customers). Remove it first.`);
          process.exitCode = 1;
        } else {
          console.log(`Building the Vijayawada demo (${VIJAYAWADA_CUSTOMER_COUNT} customers) next to the network of "${tenant.name}"…`);
          const built = createVijayawadaNetwork(data);
          const changes = { upserts: { ...built.records, auditLogs: [audit('DEMO_ADDED', `Vijayawada sample network added: ${Object.entries(built.counts).map(([k, v]) => `${v} ${k}`).join(', ')}.`)] } };
          const result = await tenant.repository.applyChanges(changes, changeSetGuard(changes), options);
          console.log(`Added (revision ${result.revision}): ${Object.entries(built.counts).map(([k, v]) => `${v} ${k}`).join(', ')}.`);
          console.log('Every demo record is marked sample data. Restart the server, then reload the app.');
        }
      } else {
        const deletes = Object.fromEntries(Object.entries(existing).filter(([, ids]) => ids && ids.length > 0));
        const total = Object.values(deletes).reduce((n, ids) => n + ids!.length, 0);
        if (total === 0) {
          console.log(`No Vijayawada demo records in "${tenant.name}". Nothing was changed.`);
        } else {
          const changes = { deletes, upserts: { auditLogs: [audit('DEMO_REMOVED', `Vijayawada sample network removed: ${total} records.`)] } };
          const result = await tenant.repository.applyChanges(changes, changeSetGuard(changes), options);
          console.log(`Removed ${total} demo records (revision ${result.revision}). Restart the server, then reload the app.`);
        }
      }
    }
  } else {
    console.log('Usage: list | reset-password <login name> | organisations | add-vijayawada-demo [organisation] | remove-vijayawada-demo [organisation]');
    process.exitCode = 2;
  }
} finally {
  await tenants.close();
}
