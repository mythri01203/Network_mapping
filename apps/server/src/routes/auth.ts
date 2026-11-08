import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  ACCOUNT_ROLES,
  type AccountRole,
  type AuthStatus,
  displayNameSchema,
  loginRequestSchema,
  PASSWORD_MAX_LENGTH,
  passwordSchema,
  usernameSchema,
} from '@fibergis/shared';

import { forbidden, loginRequired, SESSION_COOKIE } from '../auth/access';
import { type SqliteAuthStore, summaryOf } from '../auth/authStore';
import { LoginLimiter } from '../auth/loginLimiter';
import { decoyHash, hashPassword, newSessionToken, temporaryPassword, verifyPassword } from '../auth/passwords';
import type { AppConfig } from '../config';
import { HttpError, notFound } from '../lib/errors';

export interface AuthRouteOptions {
  config: AppConfig;
  store: SqliteAuthStore;
}

/** Routes anyone may call, even with login on and no session. */
export const PUBLIC_API_PATHS = new Set(['/health', '/auth/status', '/auth/login', '/auth/setup', '/auth/logout']);

/** The routes accept small JSON bodies only. */
const AUTH_BODY_LIMIT = 16 * 1024;

const tooManyTries = (seconds: number) =>
  new HttpError(
    429,
    'too_many_tries',
    `Too many wrong tries. Wait ${Math.max(1, Math.ceil(seconds / 60))} minute(s) and try again, or ask the administrator to set a new password.`,
  );

const wrongLogin = () => new HttpError(401, 'wrong_login', 'That name and password do not match. Try again, or ask the administrator.');

const setupSchema = (min: number) =>
  z.object({
    username: usernameSchema,
    displayName: displayNameSchema,
    password: passwordSchema(min),
    setupToken: z.string().max(200).optional(),
  });

const newUserSchema = (min: number) =>
  z.object({
    username: usernameSchema,
    displayName: displayNameSchema,
    role: z.enum(ACCOUNT_ROLES),
    /** Left out: the server makes a temporary one and returns it once. */
    password: passwordSchema(min).optional(),
  });

const updateUserSchema = z.object({
  displayName: displayNameSchema.optional(),
  role: z.enum(ACCOUNT_ROLES).optional(),
  active: z.boolean().optional(),
});

const changePasswordSchema = (min: number) =>
  z.object({
    currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
    newPassword: passwordSchema(min),
  });

const setPasswordSchema = (min: number) => z.object({ password: passwordSchema(min).optional() });

/**
 * Login, logout, password change, the first admin account and user management (Phase 9). Login
 * stays off ("setup" mode) until the first admin account exists, unless `AUTH_REQUIRED=true`.
 */
export const authRoutes =
  ({ config, store }: AuthRouteOptions): FastifyPluginAsync =>
  async (app) => {
    const limiter = new LoginLimiter({ maxFailures: config.loginMaxFailures, windowMs: config.loginLockMinutes * 60_000 });
    const min = config.passwordMinLength;

    const cookieOptions = (request: FastifyRequest) => ({
      path: '/',
      httpOnly: true,
      sameSite: 'strict' as const,
      secure: config.cookieSecure === 'true' || (config.cookieSecure === 'auto' && request.protocol === 'https'),
      maxAge: config.sessionDays * 86_400,
    });

    const status = (request: FastifyRequest): AuthStatus => ({
      mode: request.auth.mode,
      account: request.auth.account,
      ...(request.auth.session?.mustChangePassword ? { mustChangePassword: true } : {}),
      passwordMinLength: min,
    });

    const startSession = (request: FastifyRequest, reply: FastifyReply, userId: string) => {
      const token = newSessionToken();
      const session = store.createSession(userId, token, config.sessionDays);
      reply.setCookie(SESSION_COOKIE, token, cookieOptions(request));
      request.auth = { mode: store.hasAccounts() || config.authRequired ? 'enforced' : 'setup', account: session.account, session };
    };

    const requireAdmin = (request: FastifyRequest) => {
      if (request.auth.mode === 'setup') throw new HttpError(409, 'setup_mode', 'Login is off. Create the first administrator account first.');
      const account = request.auth.account;
      if (!account) throw loginRequired();
      if (account.role !== 'admin') throw forbidden('Only the administrator can manage user accounts.');
      return account;
    };

    const small = { bodyLimit: AUTH_BODY_LIMIT };

    app.get('/auth/status', async (request, reply) => {
      reply.header('cache-control', 'no-store');
      return status(request);
    });

    app.post('/auth/setup', small, async (request, reply) => {
      if (!store.isEmpty()) throw new HttpError(409, 'setup_done', 'An administrator account already exists. Log in instead.');
      const body = setupSchema(min).parse(request.body ?? {});
      if (config.setupToken && body.setupToken !== config.setupToken) throw forbidden('The setup code is not right. It is the SETUP_TOKEN set on the server.');
      const user = store.create({ username: body.username, displayName: body.displayName, role: 'admin', passwordHash: await hashPassword(body.password), mustChangePassword: false });
      request.log.info({ userId: user.id }, 'First administrator account created; login is now on');
      startSession(request, reply, user.id);
      reply.header('cache-control', 'no-store');
      return status(request);
    });

    app.post('/auth/login', small, async (request, reply) => {
      const { username, password } = loginRequestSchema.parse(request.body ?? {});
      const wait = limiter.retryAfterSeconds(request.ip, username);
      if (wait > 0) {
        reply.header('retry-after', wait);
        throw tooManyTries(wait);
      }
      const user = store.byUsername(username);
      const ok = user && user.active ? await verifyPassword(password, user.passwordHash) : (await verifyPassword(password, await decoyHash()), false);
      if (!ok || !user) {
        limiter.failed(request.ip, username);
        request.log.info('Login refused: wrong name or password');
        throw wrongLogin();
      }
      limiter.succeeded(request.ip, username);
      startSession(request, reply, user.id);
      request.log.info({ userId: user.id }, 'Logged in');
      reply.header('cache-control', 'no-store');
      return status(request);
    });

    app.post('/auth/logout', small, async (request, reply) => {
      if (request.auth.session) store.endSession(request.auth.session.tokenHash);
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      request.auth = { ...request.auth, account: null, session: undefined };
      return status(request);
    });

    app.post('/auth/password', small, async (request) => {
      const session = request.auth.session;
      if (!session) throw loginRequired();
      const body = changePasswordSchema(min).parse(request.body ?? {});
      const user = store.byId(session.account.id);
      if (!user || !(await verifyPassword(body.currentPassword, user.passwordHash))) {
        throw new HttpError(400, 'wrong_password', 'The current password is not right. Nothing was changed.');
      }
      store.setPassword(user.id, await hashPassword(body.newPassword), false, session.tokenHash);
      request.auth = { ...request.auth, session: { ...session, mustChangePassword: false } };
      request.log.info({ userId: user.id }, 'Password changed; other sessions ended');
      return status(request);
    });

    /**
     * Technicians' names, so the office can give a job to exactly the name the technician logs in
     * with. Names and roles only: no login names. Any logged-in account except a viewer.
     */
    app.get('/auth/technicians', async (request, reply) => {
      reply.header('cache-control', 'no-store');
      const account = request.auth.account;
      if (request.auth.mode === 'enforced' && !account) throw loginRequired();
      if (account?.role === 'viewer') return [];
      return store
        .list()
        .filter((u) => u.active && u.role === 'technician')
        .map((u) => ({ displayName: u.displayName }));
    });

    // --- User management (administrator) -----------------------------------------------------

    app.get('/users', async (request, reply) => {
      reply.header('cache-control', 'no-store');
      if (request.auth.mode === 'setup' && store.isEmpty()) return [];
      requireAdmin(request);
      return store.list().map(summaryOf);
    });

    app.post('/users', small, async (request, reply) => {
      requireAdmin(request);
      const body = newUserSchema(min).parse(request.body ?? {});
      if (store.byUsername(body.username)) throw new HttpError(409, 'username_taken', `The login name "${body.username}" is already used. Choose another.`);
      const password = body.password ?? temporaryPassword();
      const user = store.create({ username: body.username, displayName: body.displayName, role: body.role, passwordHash: await hashPassword(password), mustChangePassword: true });
      request.log.info({ userId: user.id, role: user.role }, 'Account created');
      reply.code(201).header('cache-control', 'no-store');
      // The temporary password is shown once, to the administrator who made it. It is never stored or logged.
      return { user: summaryOf(user), ...(body.password ? {} : { temporaryPassword: password }) };
    });

    app.patch<{ Params: { id: string } }>('/users/:id', small, async (request) => {
      const admin = requireAdmin(request);
      const body = updateUserSchema.parse(request.body ?? {});
      const user = store.byId(request.params.id);
      if (!user) throw notFound('That account does not exist.');
      const role: AccountRole = body.role ?? user.role;
      const active = body.active ?? user.active;
      const losesAdmin = user.role === 'admin' && user.active && (role !== 'admin' || !active);
      if (losesAdmin && store.activeAdmins() <= 1) {
        throw new HttpError(409, 'last_admin', 'This is the last administrator. Make another person administrator first, so nobody is locked out.');
      }
      const updated = store.update(user.id, { displayName: body.displayName ?? user.displayName, role, active });
      request.log.info({ userId: user.id, by: admin.id, role, active }, 'Account changed');
      return summaryOf(updated!);
    });

    app.post<{ Params: { id: string } }>('/users/:id/password', small, async (request, reply) => {
      const admin = requireAdmin(request);
      const body = setPasswordSchema(min).parse(request.body ?? {});
      const user = store.byId(request.params.id);
      if (!user) throw notFound('That account does not exist.');
      const password = body.password ?? temporaryPassword();
      // Self: keep this session. Anyone else: logged out everywhere, and asked to choose their own.
      const self = user.id === admin.id;
      store.setPassword(user.id, await hashPassword(password), !self, self ? request.auth.session?.tokenHash : undefined);
      request.log.info({ userId: user.id, by: admin.id }, 'Password set by the administrator; sessions ended');
      reply.header('cache-control', 'no-store');
      return { user: summaryOf(store.byId(user.id)!), ...(body.password ? {} : { temporaryPassword: password }) };
    });
  };
