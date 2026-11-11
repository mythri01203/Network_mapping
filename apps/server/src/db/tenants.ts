import type { FastifyRequest } from 'fastify';
import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { type OrganisationStatus, type OrganisationSummary, type PlatformEvent, randomCode } from '@fibergis/shared';

import { loginRequired } from '../auth/access';
import type { SqliteAuthStore, StoredUser } from '../auth/authStore';
import { INGEST_TOKEN_PREFIX, type MonitoringTokenStore } from '../monitoring/tokenStore';
import type { VoiceClipStore } from '../voice/clipStore';
import type { ChangeRequestStore } from './changeRequestStore';
import { ControlStore } from './controlStore';
import type { RecordHistoryStore } from './historyStore';
import type { NetworkRepository } from './repository';
import { SqliteNetworkRepository } from './sqliteRepository';

/**
 * Phase 23b: several organisations (ISPs) on one server, one database file per organisation.
 *
 * - The control database (`control.db`) lists the organisations and which one each login name
 *   belongs to. Accounts, sessions and everything else stay in each organisation's own database
 *   file, so its tables are exactly as before.
 * - The first organisation is the database at `DATABASE_PATH`, with its photos, voice and backups
 *   folders where they always were. On the first start after the upgrade it is registered in place:
 *   nothing is copied, moved or renamed.
 * - Each added organisation gets `<ORGANISATIONS_DIR>/<id>/` with `fibergis.db`, `photos/`,
 *   `voice/` and `backups/`.
 * - Every request runs with exactly one organisation (`request.tenant`, from its session), and the
 *   routes reach the data only through `scoped` objects that read the request's organisation. With
 *   no organisation they refuse (401), so a route can never fall back to another organisation.
 */

/** What every route needs from one organisation's database. `SqliteNetworkRepository` is one. */
export type TenantRepository = NetworkRepository & {
  auth: SqliteAuthStore;
  monitoringTokens: MonitoringTokenStore;
  voiceClips: VoiceClipStore;
  history: RecordHistoryStore;
  changeRequests: ChangeRequestStore;
};

export interface TenantPaths {
  databasePath: string;
  photosDir: string;
  voiceDir: string;
  backupsDir: string;
}

export interface Tenant extends TenantPaths {
  readonly id: string;
  name: string;
  status: OrganisationStatus;
  /** The first organisation (the database at DATABASE_PATH). Its administrators manage organisations. */
  readonly host: boolean;
  readonly createdAt: string;
  updatedAt: string;
  readonly repository: TenantRepository;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Phase 23b: the organisation this request works on; null when nobody is logged in. */
    tenant: Tenant | null;
  }
}

export interface TenantRegistryOptions {
  /** `control.db`, or `:memory:`. */
  controlPath: string;
  organisationsDir: string;
  /** The first organisation: the existing database and its folders, used in place. */
  host: TenantPaths & { name: string };
  /** An already open database for the first organisation (it is then not closed by `close()`). */
  hostRepository?: TenantRepository;
  /** Opens one organisation's database (with its migrations). Default: `SqliteNetworkRepository`. */
  openRepository?: (databasePath: string) => TenantRepository;
  log?: { info: (msg: string) => void; warn: (msg: string) => void };
}

/** Organisation ids are also folder names: capitals, digits and "-" only. */
const ORG_ID = /^ORG-[0-9A-Z]{8,16}$/;
const newOrganisationId = () => `ORG-${randomCode(10)}`;

/** Thrown when an organisation cannot be made or changed as asked. The routes turn it into a plain message. */
export class OrganisationError extends Error {
  constructor(
    readonly code: 'name_taken' | 'username_taken' | 'not_found' | 'host_stays_on',
    message: string,
  ) {
    super(message);
  }
}

export class TenantRegistry {
  private readonly control: ControlStore;
  private readonly tenants = new Map<string, Tenant>();
  private readonly listeners: ((tenant: Tenant) => void)[] = [];
  private readonly openRepository: (databasePath: string) => TenantRepository;
  private readonly ownsHostRepository: boolean;
  private hostId = '';
  private closed = false;

  private constructor(private readonly options: TenantRegistryOptions) {
    this.openRepository = options.openRepository ?? ((path) => new SqliteNetworkRepository(path));
    this.ownsHostRepository = !options.hostRepository;
    this.control = new ControlStore(options.controlPath);
  }

  /**
   * Opens the control database and every organisation's database. The first time (an existing
   * single-organisation install, or a fresh one), the database at `host.databasePath` is registered
   * as the first organisation, as it is: nothing in it is changed, copied or moved.
   */
  static open(options: TenantRegistryOptions): TenantRegistry {
    const registry = new TenantRegistry(options);
    try {
      registry.load();
    } catch (error) {
      void registry.close();
      throw error;
    }
    return registry;
  }

  private load() {
    const now = new Date().toISOString();
    let rows = this.control.organisations();
    if (!rows.some((r) => r.host)) {
      this.control.addOrganisation({ id: newOrganisationId(), name: this.options.host.name, status: 'active', host: true, createdAt: now, updatedAt: now });
      rows = this.control.organisations();
      this.options.log?.info(`Organisations: the database ${this.options.host.databasePath} is the first organisation, "${this.options.host.name}". Nothing in it was changed.`);
    }
    for (const row of rows) {
      const { databasePath, photosDir, voiceDir, backupsDir } = row.host ? this.options.host : this.pathsOf(row.id);
      const paths: TenantPaths = { databasePath, photosDir, voiceDir, backupsDir };
      if (!row.host && !existsSync(paths.databasePath)) {
        // Never make an empty database in place of a missing one: that would hide the loss.
        this.options.log?.warn(`Organisation "${row.name}" (${row.id}): ${paths.databasePath} is missing, so it is not opened. Put its folder back and restart.`);
        continue;
      }
      const repository = row.host && this.options.hostRepository ? this.options.hostRepository : this.openRepository(paths.databasePath);
      const tenant: Tenant = { ...row, ...paths, repository };
      if (row.host) this.hostId = row.id;
      this.tenants.set(row.id, tenant);
      this.reconcileLogins(tenant);
    }
    this.warnAboutUnknownFolders();
  }

  private pathsOf(id: string): TenantPaths {
    if (!ORG_ID.test(id)) throw new Error(`Not an organisation id: ${id}`);
    const folder = join(this.options.organisationsDir, id);
    return { databasePath: join(folder, 'fibergis.db'), photosDir: join(folder, 'photos'), voiceDir: join(folder, 'voice'), backupsDir: join(folder, 'backups') };
  }

  /** Lists every login name of an organisation in the control database (missing ones added; the first organisation to claim a name keeps it). */
  private reconcileLogins(tenant: Tenant) {
    const users = tenant.repository.auth.list();
    const names = new Set(users.map((u) => u.username));
    this.control.transaction(() => {
      for (const listed of this.control.loginsOf(tenant.id)) if (!names.has(listed.username)) this.control.removeLogin(listed.username, tenant.id);
      for (const user of users) {
        const owner = this.control.login(user.username);
        if (!owner) this.control.addLogin(user.username, tenant.id, user.id);
        else if (owner.organisationId !== tenant.id) {
          this.options.log?.warn(`Login name "${user.username}" is in two organisations; it logs in to ${owner.organisationId} only. Give the account in "${tenant.name}" another login name.`);
        }
      }
    });
  }

  private warnAboutUnknownFolders() {
    let names: string[];
    try {
      names = readdirSync(this.options.organisationsDir);
    } catch {
      return;
    }
    for (const name of names) {
      if (ORG_ID.test(name) && !this.control.organisation(name)) {
        this.options.log?.warn(`Folder ${join(this.options.organisationsDir, name)} looks like an organisation but is not in control.db; it is not opened.`);
      }
    }
  }

  // --- Lookups -------------------------------------------------------------------------------

  host(): Tenant {
    return this.tenants.get(this.hostId)!;
  }

  get(id: string): Tenant | undefined {
    return this.tenants.get(id);
  }

  all(): Tenant[] {
    return [...this.tenants.values()];
  }

  /** Login is on once any organisation has an active account. */
  hasAccounts(): boolean {
    for (const tenant of this.tenants.values()) if (tenant.repository.auth.hasAccounts()) return true;
    return false;
  }

  /** No account at all in any organisation: the first administrator may be made (in the first organisation). */
  allEmpty(): boolean {
    for (const tenant of this.tenants.values()) if (!tenant.repository.auth.isEmpty()) return false;
    return true;
  }

  /** The organisation and account behind a login name, or undefined. */
  findLogin(username: string): { tenant: Tenant; user: StoredUser } | undefined {
    const name = username.trim().toLowerCase();
    const listed = this.control.login(name);
    if (listed) {
      const tenant = this.tenants.get(listed.organisationId);
      const user = tenant?.repository.auth.byUsername(name);
      return tenant && user ? { tenant, user } : undefined;
    }
    // Made outside the server (the command-line tool): list it now, if exactly one organisation has it.
    const found = this.all()
      .map((tenant) => ({ tenant, user: tenant.repository.auth.byUsername(name) }))
      .filter((f): f is { tenant: Tenant; user: StoredUser } => !!f.user);
    if (found.length !== 1) return undefined;
    this.control.addLogin(name, found[0].tenant.id, found[0].user.id);
    return found[0];
  }

  /** Login names are unique on the whole server, so the login screen needs no organisation. */
  usernameTaken(username: string): boolean {
    const name = username.trim().toLowerCase();
    if (this.control.login(name)) return true;
    return this.all().some((tenant) => !!tenant.repository.auth.byUsername(name));
  }

  /** Lists a new account's login name. Call straight after creating it, with no `await` between. */
  registerLogin(tenant: Tenant, username: string, userId: string): void {
    if (!this.control.addLogin(username.trim().toLowerCase(), tenant.id, userId)) {
      throw new OrganisationError('username_taken', `The login name "${username}" is already used. Choose another.`);
    }
  }

  summaries(): OrganisationSummary[] {
    return this.control.organisations().map((row) => {
      const tenant = this.tenants.get(row.id);
      return { ...row, activeAccounts: tenant ? tenant.repository.auth.list().filter((u) => u.active).length : 0 };
    });
  }

  events(limit?: number): PlatformEvent[] {
    return this.control.events(limit);
  }

  recordEvent(event: Omit<PlatformEvent, 'seq' | 'at'>, now = new Date()): void {
    this.control.recordEvent({ ...event, at: now.toISOString() });
  }

  /** Runs for every organisation already open, and for every one added later. */
  onOpen(listener: (tenant: Tenant) => void): void {
    this.listeners.push(listener);
    for (const tenant of this.tenants.values()) listener(tenant);
  }

  // --- Changes (platform administrator) -------------------------------------------------------

  private refuseTakenName(name: string, exceptId?: string) {
    const wanted = name.trim().toLowerCase();
    if (this.control.organisations().some((o) => o.id !== exceptId && o.name.trim().toLowerCase() === wanted)) {
      throw new OrganisationError('name_taken', `There is already an organisation called "${name.trim()}".`);
    }
  }

  /**
   * Adds an organisation: a new folder with a new database (all migrations run), and its first
   * administrator. Synchronous from start to end, so nothing else can claim the name between the
   * checks and the writes. If anything fails, the new folder is removed again and nothing is listed.
   */
  create(input: { name: string; admin: { username: string; displayName: string; passwordHash: string } }, now = new Date()): { tenant: Tenant; admin: StoredUser } {
    const name = input.name.trim();
    this.refuseTakenName(name);
    if (this.usernameTaken(input.admin.username)) {
      throw new OrganisationError('username_taken', `The login name "${input.admin.username}" is already used. Choose another.`);
    }
    const id = newOrganisationId();
    const paths = this.pathsOf(id);
    const folder = join(this.options.organisationsDir, id);
    mkdirSync(this.options.organisationsDir, { recursive: true });
    // Not recursive: refuses a folder that is already there, so no earlier data is ever reused.
    mkdirSync(folder);
    let repository: TenantRepository | undefined;
    try {
      repository = this.openRepository(paths.databasePath);
      const admin = repository.auth.create({ ...input.admin, role: 'admin', mustChangePassword: true }, now);
      const at = now.toISOString();
      const tenant: Tenant = { id, name, status: 'active', host: false, createdAt: at, updatedAt: at, ...paths, repository };
      this.control.transaction(() => {
        this.control.addOrganisation({ id, name, status: 'active', host: false, createdAt: at, updatedAt: at });
        this.registerLogin(tenant, admin.username, admin.id);
      });
      this.tenants.set(id, tenant);
      for (const listener of this.listeners) listener(tenant);
      return { tenant, admin };
    } catch (error) {
      void repository?.close();
      rmSync(folder, { recursive: true, force: true });
      throw error;
    }
  }

  /** Renames, switches off or switches on an organisation. The first organisation is never switched off. */
  update(id: string, change: { name?: string; status?: OrganisationStatus }, now = new Date()): Tenant {
    const row = this.control.organisation(id);
    const tenant = this.tenants.get(id);
    if (!row || !tenant) throw new OrganisationError('not_found', 'That organisation does not exist on this server.');
    const name = change.name?.trim() ?? row.name;
    if (change.name !== undefined) this.refuseTakenName(name, id);
    const status = change.status ?? row.status;
    if (row.host && status !== 'active') {
      throw new OrganisationError('host_stays_on', 'The first organisation holds the platform administrators, so it cannot be switched off.');
    }
    this.control.updateOrganisation(id, { name, status }, now);
    // Switched off: every login there ends now, so switching it on again needs a fresh login.
    if (status !== 'active' && row.status === 'active') tenant.repository.auth.endAllSessions();
    tenant.name = name;
    tenant.status = status;
    tenant.updatedAt = now.toISOString();
    return tenant;
  }

  // --- Cookies and tokens ---------------------------------------------------------------------

  /**
   * The session cookie names the organisation, so the session is looked up in that organisation's
   * database only. The first organisation's cookies have no prefix, so logins made before the
   * upgrade keep working. Changing the prefix only sends the token to another database, where it
   * does not exist.
   */
  sessionCookie(tenant: Tenant, token: string): string {
    return tenant.host ? token : `${tenant.id}.${token}`;
  }

  parseSessionCookie(value: string): { tenant: Tenant; token: string } | undefined {
    const dot = value.indexOf('.');
    if (dot < 0) return { tenant: this.host(), token: value };
    const tenant = this.tenants.get(value.slice(0, dot));
    return tenant ? { tenant, token: value.slice(dot + 1) } : undefined;
  }

  /** A monitoring push token names its organisation the same way: `fgm_<org>.<secret>` (the first organisation: `fgm_<secret>`). */
  ingestToken(tenant: Tenant, token: string): string {
    return tenant.host ? token : `${INGEST_TOKEN_PREFIX}${tenant.id}.${token.slice(INGEST_TOKEN_PREFIX.length)}`;
  }

  /** The organisation a push token is for (switched on only) and the token as its own database stores it. */
  ingestTenant(token: string | undefined): { tenant: Tenant; token: string } | undefined {
    if (!token || !token.startsWith(INGEST_TOKEN_PREFIX) || token.length > 300) return undefined;
    const rest = token.slice(INGEST_TOKEN_PREFIX.length);
    const dot = rest.indexOf('.');
    const tenant = dot < 0 ? this.host() : this.tenants.get(rest.slice(0, dot));
    if (!tenant || tenant.status !== 'active') return undefined;
    return { tenant, token: dot < 0 ? token : `${INGEST_TOKEN_PREFIX}${rest.slice(dot + 1)}` };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const tenant of this.tenants.values()) {
      if (tenant.host && !this.ownsHostRepository) continue;
      await tenant.repository.close();
    }
    this.control.close();
  }
}

// --- The request's organisation ---------------------------------------------------------------

/**
 * The platform administrator: a logged-in administrator of the first organisation. Only they may
 * list, add, switch off and switch on organisations; they still read and change only their own
 * organisation's network. Never in setup mode (login off).
 */
export const isPlatformAdmin = (request: FastifyRequest): boolean =>
  request.auth.mode === 'enforced' && !!request.auth.session && request.auth.account?.role === 'admin' && !!request.tenant?.host && request.tenant.status === 'active';

/** `null`: the request has no organisation (nobody logged in). */
const context = new AsyncLocalStorage<Tenant | null>();

/** Runs a route handler with its request's organisation. */
export const runInTenant = <T>(tenant: Tenant | null, fn: () => T): T => context.run(tenant, fn);

/** The organisation of the request being handled. Refuses (401) when there is none; never falls back to another. */
export function currentTenant(): Tenant {
  const tenant = context.getStore();
  if (tenant === undefined) throw new Error('Organisation data was reached outside a request.');
  if (tenant === null) throw loginRequired();
  return tenant;
}

/**
 * An object that stands for one part of the request's organisation (its repository, account store
 * and so on). Every property is looked up on the current organisation at the moment it is used, so
 * the routes are written exactly as for one database.
 */
export function scoped<T extends object>(pick: (tenant: Tenant) => T): T {
  return new Proxy({} as T, {
    get(_target, property) {
      const target = pick(currentTenant());
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
    has(_target, property) {
      return property in pick(currentTenant());
    },
  });
}

/**
 * Monitoring push tokens for the routes: made, listed and revoked in the request's organisation;
 * a pushed token is looked up in the organisation it names (switched-on organisations only).
 */
export function tenantTokenRouter(registry: TenantRegistry): Pick<MonitoringTokenStore, 'issue' | 'sourceFor' | 'revoke' | 'info'> {
  return {
    issue(sourceId, createdBy, now) {
      const tenant = currentTenant();
      return registry.ingestToken(tenant, tenant.repository.monitoringTokens.issue(sourceId, createdBy, now));
    },
    sourceFor(token, now) {
      const found = registry.ingestTenant(token);
      return found ? found.tenant.repository.monitoringTokens.sourceFor(found.token, now) : undefined;
    },
    revoke: (sourceId) => currentTenant().repository.monitoringTokens.revoke(sourceId),
    info: (sourceId) => currentTenant().repository.monitoringTokens.info(sourceId),
  };
}
