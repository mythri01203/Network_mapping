import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { API_PREFIX, LESSON_SCRIPTS } from '@fibergis/shared';

import { buildApp } from '../src/app';
import { type AppConfig, loadConfig } from '../src/config';
import { SqliteNetworkRepository } from '../src/db/sqliteRepository';
import { audioFormatOf, SARVAM_TTS_URL } from '../src/voice/sarvam';

/** Voice lessons (learning assistant, Stage 1). Sarvam is always faked: no test reaches the paid service. */

const api = (path: string) => `${API_PREFIX}${path}`;
const FAKE_KEY = 'test-key-never-real-0123456789';
/** A tiny MP3: an ID3 tag and a frame header are enough for the format check. */
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.from([4, 0, 0, 0, 0, 0, 0]), Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(64)]);

let app: FastifyInstance;
let repository: SqliteNetworkRepository;
let voiceDir: string;
let sarvam: ReturnType<typeof vi.fn>;

async function start(overrides: Partial<AppConfig> = {}, answer: () => Response = () => Response.json({ request_id: 'r1', audios: [MP3.toString('base64')] })) {
  voiceDir = join(mkdtempSync(join(tmpdir(), 'fibergis-voice-')), 'voice');
  const config: AppConfig = {
    ...loadConfig({ LOG_LEVEL: 'silent', STATIC_DIR: join(tmpdir(), 'fibergis-no-static') }),
    databasePath: ':memory:',
    photosDir: join(mkdtempSync(join(tmpdir(), 'fibergis-photos-')), 'photos'),
    backupsDir: join(mkdtempSync(join(tmpdir(), 'fibergis-backups-')), 'backups'),
    voiceDir,
    sarvamApiKey: FAKE_KEY,
    ...overrides,
  };
  repository = new SqliteNetworkRepository(config.databasePath);
  sarvam = vi.fn(async () => answer());
  app = await buildApp({ config, repository, voiceFetch: sarvam as unknown as typeof fetch });
}

afterEach(async () => {
  await app.close();
  await repository.close();
});

const send = (method: InjectOptions['method'], path: string, payload?: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method, url: api(path), ...(payload === undefined ? {} : { payload: payload as object }), headers });
const cookieOf = (response: LightMyRequestResponse) => String([response.headers['set-cookie']].flat()[0] ?? '').split(';')[0];

describe('voice clips from Sarvam (faked)', () => {
  it('makes a draft clip from the server script, sending the key only to Sarvam', async () => {
    await start();
    const made = await send('POST', '/voice/generate', { lessonKey: 'welcome.intro', language: 'te' });
    expect(made.statusCode).toBe(200);
    const { clip, reused } = made.json();
    expect(reused).toBe(false);
    expect(clip).toMatchObject({ lessonKey: 'welcome.intro', language: 'te', status: 'draft', format: 'mp3', model: 'bulbul:v4-flash', voice: 'kavitha_te_conversation' });
    const [url, init] = sarvam.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(SARVAM_TTS_URL);
    expect((init.headers as Record<string, string>)['api-subscription-key']).toBe(FAKE_KEY);
    const sent = JSON.parse(String(init.body));
    expect(sent).toMatchObject({ language_code: 'te-IN', model: 'bulbul:v4-flash', text: LESSON_SCRIPTS[0].text.te.text });
    expect(readdirSync(voiceDir)).toEqual([`${clip.id}.mp3`]);
    // The key is in no answer.
    expect(made.body).not.toContain(FAKE_KEY);
    expect((await send('GET', '/voice/scripts')).body).not.toContain(FAKE_KEY);
  });

  it('reuses a clip of the same words instead of paying again', async () => {
    await start();
    const first = (await send('POST', '/voice/generate', { lessonKey: 'welcome.intro', language: 'en' })).json();
    const again = (await send('POST', '/voice/generate', { lessonKey: 'welcome.intro', language: 'en' })).json();
    expect(again).toMatchObject({ reused: true, clip: { id: first.clip.id } });
    expect(sarvam).toHaveBeenCalledTimes(1);
  });

  it('generates only from server scripts, never from text sent by a browser', async () => {
    await start();
    expect((await send('POST', '/voice/generate', { lessonKey: 'welcome.intro', language: 'en', text: 'say anything' })).statusCode).toBe(400);
    expect((await send('POST', '/voice/generate', { lessonKey: 'no.such.lesson', language: 'en' })).statusCode).toBe(404);
    expect((await send('POST', '/voice/generate', { lessonKey: 'welcome.intro', language: 'hi' })).statusCode).toBe(400);
    expect(sarvam).not.toHaveBeenCalled();
  });

  it('says plainly when no key is set, and when the daily limit would be passed', async () => {
    await start({ sarvamApiKey: undefined });
    const none = await send('POST', '/voice/generate', { lessonKey: 'welcome.intro', language: 'en' });
    expect(none.statusCode).toBe(503);
    expect(none.json().error).toBe('voice_not_configured');
    await app.close();
    await repository.close();
    await start({ sarvamDailyCharLimit: 100 });
    const capped = await send('POST', '/voice/generate', { lessonKey: 'welcome.intro', language: 'en' });
    expect(capped.statusCode).toBe(429);
    expect(capped.json().error).toBe('voice_daily_limit');
    expect(sarvam).not.toHaveBeenCalled();
  });

  it('keeps nothing when Sarvam refuses or sends something that is not audio', async () => {
    await start({}, () => Response.json({ error: { message: 'Invalid speaker' } }, { status: 400 }));
    const refused = await send('POST', '/voice/generate', { lessonKey: 'welcome.intro', language: 'kn' });
    expect(refused.statusCode).toBe(502);
    expect(refused.json().message).toMatch(/HTTP 400.*Invalid speaker/);
    await app.close();
    await repository.close();
    await start({}, () => Response.json({ audios: [Buffer.from('<html>not audio</html>').toString('base64')] }));
    expect((await send('POST', '/voice/generate', { lessonKey: 'welcome.intro', language: 'kn' })).json().error).toBe('voice_bad_audio');
    expect(existsSync(voiceDir) ? readdirSync(voiceDir) : []).toEqual([]);
    expect((await send('GET', '/voice/clips')).json().clips).toEqual([]);
  });

  it('plays drafts only to the administrator, and needs a native speaker to approve Telugu', async () => {
    await start();
    const { clip } = (await send('POST', '/voice/generate', { lessonKey: 'welcome.intro', language: 'te' })).json();
    expect((await send('GET', `/voice/audio/${clip.id}`)).headers['content-type']).toBe('audio/mpeg'); // setup mode = server computer
    const owner = cookieOf(await send('POST', '/auth/setup', { username: 'owner', displayName: 'Owner', password: 'owner-pass-1' }));
    await send('POST', '/users', { username: 'ravi', displayName: 'Ravi', role: 'technician', password: 'ravi-pass-1' }, { cookie: owner });
    const ravi = cookieOf(await send('POST', '/auth/login', { username: 'ravi', password: 'ravi-pass-1' }));
    await send('POST', '/auth/password', { currentPassword: 'ravi-pass-1', newPassword: 'ravi-pass-2' }, { cookie: ravi });
    expect((await send('GET', `/voice/audio/${clip.id}`, undefined, { cookie: ravi })).statusCode).toBe(404);
    expect((await send('GET', '/voice/clips', undefined, { cookie: ravi })).json().clips).toEqual([]);
    expect((await send('POST', '/voice/generate', { lessonKey: 'welcome.intro', language: 'en' }, { cookie: ravi })).statusCode).toBe(403);

    const noNative = await send('POST', `/voice/clips/${clip.id}/review`, { status: 'approved', reviewer: 'Owner' }, { cookie: owner });
    expect(noNative.json().error).toBe('native_review_needed');
    const ok = await send('POST', `/voice/clips/${clip.id}/review`, { status: 'approved', reviewer: 'Lakshmi (Telugu)', nativeSpeakerChecked: true }, { cookie: owner });
    expect(ok.json().clip).toMatchObject({ status: 'approved', reviewedBy: 'Lakshmi (Telugu)' });
    const heard = await send('GET', `/voice/audio/${clip.id}`, undefined, { cookie: ravi });
    expect(heard.statusCode).toBe(200);
    expect(heard.rawPayload.subarray(0, 3).toString()).toBe('ID3');
  });

  it('refuses a clip id that could point anywhere else', async () => {
    await start();
    for (const bad of ['..%2F..%2Fetc%2Fpasswd', 'VC-short', 'VC-ABCDEFGHIJ.mp3']) {
      expect((await send('GET', `/voice/audio/${bad}`)).statusCode).toBe(400);
    }
  });

  it('recognises MP3 and WAV audio and nothing else', () => {
    expect(audioFormatOf(MP3)).toBe('mp3');
    expect(audioFormatOf(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')]))).toBe('wav');
    expect(audioFormatOf(Buffer.from('{"error":1}'))).toBeNull();
  });
});
