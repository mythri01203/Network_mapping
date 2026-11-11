import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

import { AUDIT_ROLE_FOR, formatLogTimestamp, LESSON_SCRIPTS, lessonScript, MAX_SCRIPT_CHARS, randomCode, roleMay, VOICE_LANGUAGES, type VoiceClip } from '@fibergis/shared';

import { noStore, requireSystem } from '../auth/access';
import type { NetworkRepository } from '../db/repository';
import { badRequest, HttpError, notFound } from '../lib/errors';
import { CLIP_ID_PATTERN, newClipId, scriptHashOf, type VoiceClipStore } from '../voice/clipStore';
import { SARVAM_VOICES, synthesize, VoiceError } from '../voice/sarvam';

/**
 * Voice lessons (learning assistant, Stage 1). Generating a clip costs money, so only the
 * administrator may, from the server's own lesson scripts, never from text a browser sends; a clip
 * of the same words, voice and model is reused; a daily character cap and a rate limit guard the
 * bill. New clips are drafts: field users hear only approved ones, and a Telugu or Kannada clip is
 * approved only with a native speaker's name.
 */

export interface VoiceRouteOptions {
  repository: NetworkRepository;
  clips: VoiceClipStore;
  voiceDir: string;
  apiKey?: string;
  model: 'bulbul:v3' | 'bulbul:v4-flash';
  dailyCharLimit: number;
  timeoutMs: number;
  /** Injected for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

const generateSchema = z.strictObject({ lessonKey: z.string().min(1).max(80), language: z.enum(VOICE_LANGUAGES) });
const reviewSchema = z.strictObject({
  status: z.enum(['draft', 'approved', 'rejected']),
  reviewer: z.string().trim().min(2).max(80),
  /** Telugu and Kannada: a native speaker listened and checked the words. */
  nativeSpeakerChecked: z.boolean().optional(),
});

const startOfDay = (now: Date) => new Date(now.getFullYear(), now.getMonth(), now.getDate());

export const voiceRoutes =
  (options: VoiceRouteOptions): FastifyPluginAsync =>
  async (app) => {
    const { clips, repository } = options;
    /** Phase 23b: read on every use, so a getter can give the request's organisation's folder. */
    const voiceDirNow = () => options.voiceDir;

    const canManage = (request: FastifyRequest) => request.auth.mode === 'setup' || (!!request.auth.account && roleMay(request.auth.account.role, 'manage_voice'));

    /** True when the lesson's words (for this clip's voice and model) have changed since it was made. */
    const outdated = (clip: VoiceClip) => {
      const text = lessonScript(clip.lessonKey)?.text[clip.language]?.text;
      return !text || scriptHashOf(text, clip.voice, clip.model) !== clip.scriptHash;
    };
    const shown = (clip: VoiceClip): VoiceClip => ({ ...clip, ...(outdated(clip) ? { outdated: true } : {}) });

    const audit = async (request: FastifyRequest, action: string, details: string, assetId: string) => {
      const account = request.auth.account;
      await repository.applyChanges({
        upserts: {
          auditLogs: [
            {
              id: `LOG-${randomCode(10)}`,
              timestamp: formatLogTimestamp(new Date()),
              user: account ? account.displayName : 'Setup mode (login off)',
              role: account ? AUDIT_ROLE_FOR[account.role] : 'Administrator',
              action,
              details: details.slice(0, 1000),
              assetId,
              assetType: 'System',
            },
          ],
        },
      });
    };

    /** The lesson scripts and, for the administrator, whether voice is set up. Never the key. */
    app.get('/voice/scripts', async (request, reply) => {
      noStore(reply);
      return {
        configured: canManage(request) ? !!options.apiKey : undefined,
        model: options.model,
        scripts: LESSON_SCRIPTS.map((s) => ({ key: s.key, title: s.title, text: s.text })),
      };
    });

    /** Approved, current clips for everyone; every clip for the administrator. */
    app.get('/voice/clips', async (request, reply) => {
      noStore(reply);
      const all = clips.list().map(shown);
      return { clips: canManage(request) ? all : all.filter((c) => c.status === 'approved' && !c.outdated) };
    });

    app.post('/voice/generate', { config: { rateLimit: { max: 10, timeWindow: 60_000 } } }, async (request) => {
      const account = requireSystem(request, 'manage_voice');
      const body = generateSchema.parse(request.body ?? {});
      const script = lessonScript(body.lessonKey);
      if (!script) throw notFound(`There is no lesson script called ${body.lessonKey}.`);
      const text = script.text[body.language].text;
      if (text.length === 0 || text.length > MAX_SCRIPT_CHARS) throw badRequest(`The script must be 1 to ${MAX_SCRIPT_CHARS} characters.`);
      const voice = SARVAM_VOICES[options.model][body.language];
      const scriptHash = scriptHashOf(text, voice, options.model);

      // The same words, voice and model already have a clip: reuse it, pay nothing.
      const existing = clips.existing(scriptHash, body.language);
      if (existing) return { clip: shown(existing), reused: true, charactersUsedToday: clips.charactersSince(startOfDay(new Date())) };

      if (!options.apiKey) throw new HttpError(503, 'voice_not_configured', 'Voice is not set up on this server: put SARVAM_API_KEY in apps/server/.env and restart the server.');
      const used = clips.charactersSince(startOfDay(new Date()));
      if (used + text.length > options.dailyCharLimit) {
        throw new HttpError(429, 'voice_daily_limit', `Today's voice limit (${options.dailyCharLimit} characters, SARVAM_DAILY_CHAR_LIMIT) would be passed: ${used} used. Nothing was generated.`);
      }

      let speech;
      try {
        speech = await synthesize({ apiKey: options.apiKey, model: options.model, language: body.language, text, timeoutMs: options.timeoutMs, fetch: options.fetch });
      } catch (error) {
        if (error instanceof VoiceError) {
          request.log.warn({ code: error.code, upstreamStatus: error.upstreamStatus }, 'Voice generation failed');
          throw new HttpError(error.code === 'not_configured' ? 503 : 502, `voice_${error.code}`, error.message);
        }
        throw error;
      }

      const id = newClipId();
      const voiceDir = voiceDirNow();
      await mkdir(voiceDir, { recursive: true });
      const file = join(voiceDir, `${id}.${speech.format}`);
      await writeFile(`${file}.part`, speech.audio);
      await rename(`${file}.part`, file);
      const clip = clips.add({ id, lessonKey: script.key, language: body.language, scriptHash, model: options.model, voice: speech.voice, characters: text.length, bytes: speech.audio.length, format: speech.format, createdBy: account?.id ?? null });
      await audit(request, 'VOICE_CLIP_GENERATED', `${script.key} (${body.language}), ${text.length} characters, ${options.model} voice ${speech.voice}. Draft until reviewed.`, clip.id);
      request.log.info({ clipId: clip.id, lessonKey: script.key, language: body.language, characters: text.length }, 'Voice clip generated');
      return { clip: shown(clip), reused: false, charactersUsedToday: used + text.length };
    });

    app.post<{ Params: { id: string } }>('/voice/clips/:id/review', async (request) => {
      requireSystem(request, 'manage_voice');
      if (!CLIP_ID_PATTERN.test(request.params.id)) throw badRequest('That is not a voice clip id.');
      const body = reviewSchema.parse(request.body ?? {});
      const clip = clips.get(request.params.id);
      if (!clip) throw notFound('That voice clip does not exist.');
      if (body.status === 'approved') {
        if (outdated(clip)) throw new HttpError(409, 'voice_outdated', 'The lesson words have changed since this clip was made. Make a new clip instead.');
        if (clip.language !== 'en' && body.nativeSpeakerChecked !== true) {
          throw new HttpError(409, 'native_review_needed', 'A Telugu or Kannada clip is approved only after a native speaker has listened to it and checked the words.');
        }
      }
      const updated = clips.review(clip.id, body.status, body.reviewer);
      await audit(request, 'VOICE_CLIP_REVIEWED', `${clip.lessonKey} (${clip.language}) marked ${body.status} by ${body.reviewer}${body.nativeSpeakerChecked ? ' (native speaker checked)' : ''}.`, clip.id);
      return { clip: shown(updated!) };
    });

    /** The audio. Field users get approved, current clips only; the administrator may hear drafts. */
    app.get<{ Params: { id: string } }>('/voice/audio/:id', async (request, reply) => {
      if (!CLIP_ID_PATTERN.test(request.params.id)) throw badRequest('That is not a voice clip id.');
      const clip = clips.get(request.params.id);
      if (!clip || (!canManage(request) && (clip.status !== 'approved' || outdated(clip)))) throw notFound('That voice clip is not available.');
      let audio: Buffer;
      try {
        audio = await readFile(join(voiceDirNow(), `${clip.id}.${clip.format}`));
      } catch {
        throw notFound('The audio file for this clip is missing on the server.');
      }
      reply.header('content-type', clip.format === 'wav' ? 'audio/wav' : 'audio/mpeg');
      reply.header('cache-control', clip.status === 'approved' ? 'private, max-age=31536000, immutable' : 'no-store');
      return reply.send(audio);
    });
  };
