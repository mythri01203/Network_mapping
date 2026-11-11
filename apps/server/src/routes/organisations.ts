import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { displayNameSchema, organisationNameSchema, type OrganisationSummary, passwordSchema, usernameSchema } from '@fibergis/shared';

import { forbidden, loginRequired, noStore } from '../auth/access';
import { summaryOf } from '../auth/authStore';
import { hashPassword, temporaryPassword } from '../auth/passwords';
import type { AppConfig } from '../config';
import { isPlatformAdmin, OrganisationError, type Tenant, type TenantRegistry } from '../db/tenants';
import { HttpError, notFound } from '../lib/errors';

/**
 * Phase 23b: the organisations (ISPs) on this server, for the platform administrator (an
 * administrator of the first organisation). They can list, add, rename, switch off and switch on
 * organisations, and give a new one its first administrator. They never see another organisation's
 * network, accounts or files through these routes: only its name, state and number of accounts.
 * Each organisation's own administrator manages its accounts in Users and roles, as before.
 */

export interface OrganisationRouteOptions {
  config: AppConfig;
  tenants: TenantRegistry;
}

const SMALL = { bodyLimit: 16 * 1024 };

const createSchema = (min: number) =>
  z.strictObject({
    name: organisationNameSchema,
    admin: z.strictObject({
      username: usernameSchema,
      displayName: displayNameSchema,
      /** Left out: the server makes a temporary one and returns it once. */
      password: passwordSchema(min).optional(),
    }),
  });

const updateSchema = z.strictObject({
  name: organisationNameSchema.optional(),
  status: z.enum(['active', 'suspended']).optional(),
});

const summaryOfTenant = (tenants: TenantRegistry, tenant: Tenant): OrganisationSummary => tenants.summaries().find((s) => s.id === tenant.id)!;

/** Turns a refused organisation change into the plain message the screen shows. */
const asHttp = (error: unknown): never => {
  if (error instanceof OrganisationError) {
    if (error.code === 'not_found') throw notFound(error.message);
    throw new HttpError(409, error.code, error.message);
  }
  throw error;
};

export const organisationRoutes =
  ({ config, tenants }: OrganisationRouteOptions): FastifyPluginAsync =>
  async (app) => {
    const requirePlatformAdmin = (request: FastifyRequest) => {
      if (request.auth.mode === 'setup') throw new HttpError(409, 'setup_mode', 'Login is off. Create the first administrator account first.');
      const account = request.auth.account;
      if (!account) throw loginRequired();
      if (!isPlatformAdmin(request)) throw forbidden('Only an administrator of the first organisation on this server can manage organisations.');
      return account;
    };

    app.get('/platform/organisations', async (request, reply) => {
      requirePlatformAdmin(request);
      noStore(reply);
      return { organisations: tenants.summaries(), events: tenants.events(30) };
    });

    app.post('/platform/organisations', SMALL, async (request, reply) => {
      const account = requirePlatformAdmin(request);
      const body = createSchema(config.passwordMinLength).parse(request.body ?? {});
      const password = body.admin.password ?? temporaryPassword();
      const passwordHash = await hashPassword(password);
      let made: ReturnType<TenantRegistry['create']>;
      try {
        // Synchronous from the name checks to the listing, so nothing else can claim the names between.
        made = tenants.create({ name: body.name, admin: { username: body.admin.username, displayName: body.admin.displayName, passwordHash } });
      } catch (error) {
        return asHttp(error);
      }
      const { tenant, admin } = made;
      tenants.recordEvent({ actorId: account.id, actorName: account.displayName, action: 'ORGANISATION_ADDED', organisationId: tenant.id, details: `"${tenant.name}" added, first administrator ${admin.username}.` });
      request.log.info({ organisationId: tenant.id, by: account.id }, 'Organisation added');
      reply.code(201);
      noStore(reply);
      // The temporary password is shown once, to the platform administrator. It is never stored or logged.
      return { organisation: summaryOfTenant(tenants, tenant), admin: summaryOf(admin), ...(body.admin.password ? {} : { temporaryPassword: password }) };
    });

    app.patch<{ Params: { id: string } }>('/platform/organisations/:id', SMALL, async (request) => {
      const account = requirePlatformAdmin(request);
      const body = updateSchema.parse(request.body ?? {});
      const before = tenants.get(request.params.id);
      const was = before ? { name: before.name, status: before.status } : undefined;
      let tenant: Tenant;
      try {
        tenant = tenants.update(request.params.id, body);
      } catch (error) {
        return asHttp(error);
      }
      const changes = [
        was && body.name !== undefined && body.name.trim() !== was.name ? `renamed from "${was.name}" to "${tenant.name}"` : '',
        was && body.status !== undefined && body.status !== was.status ? (body.status === 'active' ? 'switched on' : 'switched off (nobody in it can log in; its data is kept)') : '',
      ].filter(Boolean);
      if (changes.length > 0) {
        const action = body.status && was && body.status !== was.status ? (body.status === 'active' ? 'ORGANISATION_SWITCHED_ON' : 'ORGANISATION_SWITCHED_OFF') : 'ORGANISATION_RENAMED';
        tenants.recordEvent({ actorId: account.id, actorName: account.displayName, action, organisationId: tenant.id, details: `"${tenant.name}" ${changes.join(', ')}.` });
        request.log.info({ organisationId: tenant.id, by: account.id, status: tenant.status }, 'Organisation changed');
      }
      return { organisation: summaryOfTenant(tenants, tenant) };
    });
  };
