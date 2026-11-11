import type { FastifyPluginAsync } from 'fastify';
import { createReadStream } from 'node:fs';
import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { PHOTO_ID_PATTERN, photoUrl } from '@fibergis/shared';

import { requireSystem } from '../auth/access';
import { badRequest, HttpError, notFound } from '../lib/errors';

/** Phone photos are compressed to about 1280 px before upload, so 5 MB leaves a wide margin. */
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface PhotoType {
  ext: string;
  /** True when the bytes really start like this kind of picture. */
  matches: (body: Buffer) => boolean;
}

const PHOTO_TYPES: Record<string, PhotoType> = {
  'image/jpeg': { ext: 'jpg', matches: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', matches: (b) => b.length > 8 && b.subarray(0, 8).equals(PNG_SIGNATURE) },
  'image/webp': {
    ext: 'webp',
    matches: (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  },
};

const unsupported = (message: string) => new HttpError(415, 'unsupported_media_type', message);

export interface PhotoRouteOptions {
  /** Folder that holds one file per photo, named by its id. Created on the first upload. */
  /** Phase 23b: or a function giving the request's organisation's folder, read on every use. */
  dir: string | (() => string);
  maxBytes?: number;
}

interface PhotoParams {
  id: string;
}

/**
 * Field photos as files: `PUT /photos/<id>` stores one, `GET /photos/<id>` serves it. The id is
 * chosen by the phone when the photo is taken, so a repeated upload stores nothing new and answers
 * 200 instead of 201. A stored photo is never replaced, because records point at it as evidence.
 */
export const photoRoutes =
  ({ dir, maxBytes = PHOTO_MAX_BYTES }: PhotoRouteOptions): FastifyPluginAsync =>
  async (app) => {
    const folder = () => (typeof dir === 'function' ? dir() : dir);
    // Scoped to this plugin: other routes still accept JSON only.
    app.addContentTypeParser(/^image\//, { parseAs: 'buffer', bodyLimit: maxBytes }, (_request, body, done) => {
      done(null, body);
    });

    const checkId = (id: string) => {
      if (!PHOTO_ID_PATTERN.test(id)) throw badRequest('A photo id is 6 to 64 letters, digits, "-" or "_".');
    };

    const findStored = async (id: string) => {
      for (const [type, spec] of Object.entries(PHOTO_TYPES)) {
        const path = join(folder(), `${id}.${spec.ext}`);
        try {
          const info = await stat(path);
          if (info.isFile()) return { path, type, size: info.size };
        } catch {
          // Not stored with this extension.
        }
      }
      return null;
    };

    app.put<{ Params: PhotoParams }>('/photos/:id', async (request, reply) => {
      // Look-only accounts send no photos (Phase 9). Login is checked for every API request.
      requireSystem(request, 'upload_photo');
      const { id } = request.params;
      checkId(id);
      const type = String(request.headers['content-type'] ?? '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      const spec = PHOTO_TYPES[type];
      if (!spec) throw unsupported('Photos must be JPEG, PNG or WebP pictures.');
      const body = request.body;
      if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest('The photo is empty.');
      if (!spec.matches(body)) throw unsupported(`The file is not a real ${type.slice(6).toUpperCase()} picture.`);

      const stored = await findStored(id);
      if (stored) return reply.code(200).send({ id, url: photoUrl(id), bytes: stored.size, created: false });

      await mkdir(folder(), { recursive: true });
      const target = join(folder(), `${id}.${spec.ext}`);
      const temp = `${target}.${process.pid}-${Date.now()}.part`;
      try {
        // Write then rename, so a half-written file never looks like a stored photo.
        await writeFile(temp, body, { flag: 'wx' });
        await rename(temp, target);
      } catch (error) {
        await unlink(temp).catch(() => undefined);
        throw error;
      }
      return reply.code(201).send({ id, url: photoUrl(id), bytes: body.length, created: true });
    });

    app.get<{ Params: PhotoParams }>('/photos/:id', async (request, reply) => {
      const { id } = request.params;
      checkId(id);
      const stored = await findStored(id);
      if (!stored) throw notFound(`Photo ${id} is not on the server yet.`);
      return reply
        .header('content-type', stored.type)
        .header('content-length', stored.size)
        // A photo id never changes content, so it can be cached for good.
        .header('cache-control', 'private, max-age=31536000, immutable')
        .send(createReadStream(stored.path));
    });
  };
