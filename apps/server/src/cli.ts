/**
 * Account help from the server's own computer, for when nobody can log in:
 *
 *   npm run user -w @fibergis/server -- list
 *   npm run user -w @fibergis/server -- reset-password <login name>
 *
 * Uses DATABASE_PATH like the server. Prints a temporary password once; it is never stored or logged.
 * Whoever can run this already has the database file, so it adds no new way in.
 */
/* eslint-disable no-console -- a command-line tool: printing to the terminal is its job. */
import { hashPassword, temporaryPassword } from './auth/passwords';
import { loadConfig } from './config';
import { SqliteNetworkRepository } from './db/sqliteRepository';

const [command, name] = process.argv.slice(2);
const config = loadConfig();
const repository = new SqliteNetworkRepository(config.databasePath);
const store = repository.auth;

try {
  if (command === 'list') {
    const users = store.list();
    if (users.length === 0) console.log('No accounts yet: login is off (setup mode).');
    for (const u of users) console.log(`${u.username}\t${u.role}\t${u.active ? 'active' : 'switched off'}\t${u.displayName}`);
  } else if (command === 'reset-password' && name) {
    const user = store.byUsername(name);
    if (!user) {
      console.error(`No account with the login name "${name}". Run "list" to see them.`);
      process.exitCode = 1;
    } else {
      const password = temporaryPassword(12);
      store.setPassword(user.id, await hashPassword(password), true);
      if (!user.active) store.update(user.id, { displayName: user.displayName, role: user.role, active: true });
      console.log(`New temporary password for ${user.username}: ${password}`);
      console.log('They will be asked to choose their own after logging in. All their sessions were ended.');
    }
  } else {
    console.log('Usage: list | reset-password <login name>');
    process.exitCode = 2;
  }
} finally {
  await repository.close();
}
