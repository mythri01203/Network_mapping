import { SARVAM_LANGUAGE_CODES, type VoiceLanguage } from '@fibergis/shared';

/**
 * The one place that talks to Sarvam AI (text to speech). The key travels only in the request
 * header to api.sarvam.ai; it is never logged, returned or put in an error message. One request,
 * no automatic retry (every request costs money), with a timeout.
 */

export const SARVAM_TTS_URL = 'https://api.sarvam.ai/text-to-speech';

/** Voices used for lessons, per model and language (from Sarvam's voice list). */
export const SARVAM_VOICES: Record<'bulbul:v3' | 'bulbul:v4-flash', Record<VoiceLanguage, string>> = {
  'bulbul:v4-flash': { en: 'simran_en_customer', te: 'kavitha_te_conversation', kn: 'chaitra_kn_conversation' },
  'bulbul:v3': { en: 'priya', te: 'priya', kn: 'ishita' },
};

export type SarvamModel = 'bulbul:v3' | 'bulbul:v4-flash';

/** The voice a language is spoken in: Sarvam model, speaker, and (bulbul:v3 only) pace and liveliness. */
export interface VoiceChoice {
  model: SarvamModel;
  speaker: string;
  pace?: number;
  temperature?: number;
}

/**
 * Telugu is always Ritu on bulbul:v3, a little faster and livelier than normal (chosen by the
 * owner by ear, 13 Nov 2026). Other languages use the model set in SARVAM_MODEL.
 */
export function voiceFor(model: SarvamModel, language: VoiceLanguage): VoiceChoice {
  if (language === 'te') return { model: 'bulbul:v3', speaker: 'ritu', pace: 1.15, temperature: 0.8 };
  return { model, speaker: SARVAM_VOICES[model][language] };
}

/** How a voice is named on a clip, so a change of speaker, pace or liveliness makes a new clip. */
export const voiceLabel = (v: VoiceChoice): string =>
  v.speaker + (v.pace !== undefined ? ` pace ${v.pace}` : '') + (v.temperature !== undefined ? ` temperature ${v.temperature}` : '');

/** Largest clip kept (a lesson step is a few seconds). */
export const MAX_CLIP_BYTES = 5 * 1024 * 1024;

export class VoiceError extends Error {
  constructor(
    readonly code: 'not_configured' | 'timeout' | 'sarvam_refused' | 'sarvam_failed' | 'bad_audio',
    message: string,
    readonly upstreamStatus?: number,
  ) {
    super(message);
    this.name = 'VoiceError';
  }
}

export interface SpeechRequest {
  apiKey: string;
  model: 'bulbul:v3' | 'bulbul:v4-flash';
  language: VoiceLanguage;
  text: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

export interface Speech {
  audio: Buffer;
  format: 'mp3' | 'wav';
  voice: string;
  model: SarvamModel;
}

/** MP3 (ID3 tag or frame sync) or WAV (RIFF....WAVE). Anything else is refused. */
export function audioFormatOf(bytes: Buffer): 'mp3' | 'wav' | null {
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') return 'wav';
  if (bytes.length >= 3 && bytes.toString('ascii', 0, 3) === 'ID3') return 'mp3';
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'mp3';
  return null;
}

export async function synthesize({ apiKey, model, language, text, timeoutMs, fetch: doFetch = fetch }: SpeechRequest): Promise<Speech> {
  if (!apiKey) throw new VoiceError('not_configured', 'Voice is not set up on this server: SARVAM_API_KEY is missing.');
  const choice = voiceFor(model, language);
  const voice = voiceLabel(choice);
  let response: Response;
  try {
    response = await doFetch(SARVAM_TTS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'api-subscription-key': apiKey },
      body: JSON.stringify({
        text,
        language_code: SARVAM_LANGUAGE_CODES[language],
        model: choice.model,
        speaker: choice.speaker,
        ...(choice.pace !== undefined ? { pace: choice.pace } : {}),
        ...(choice.temperature !== undefined ? { temperature: choice.temperature } : {}),
        output_audio_codec: 'mp3',
        speech_sample_rate: 24000,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new VoiceError(timedOut ? 'timeout' : 'sarvam_failed', timedOut ? 'Sarvam did not answer in time. Nothing was saved; try again later.' : 'Sarvam could not be reached. Nothing was saved; check the internet connection.');
  }
  if (!response.ok) {
    // Sarvam's own words can help (a wrong voice name, no credit left) but never echo anything else.
    let reason = '';
    try {
      const body = (await response.json()) as { error?: { message?: unknown }; message?: unknown };
      const message = body?.error?.message ?? body?.message;
      if (typeof message === 'string') reason = ` Sarvam said: ${message.slice(0, 200)}`;
    } catch {
      // Not JSON: no detail.
    }
    const refused = response.status === 400 || response.status === 401 || response.status === 403 || response.status === 402 || response.status === 429;
    throw new VoiceError(refused ? 'sarvam_refused' : 'sarvam_failed', `Sarvam refused the request (HTTP ${response.status}). Nothing was saved.${reason}`, response.status);
  }
  const body = (await response.json().catch(() => null)) as { audios?: unknown } | null;
  const first = Array.isArray(body?.audios) ? body.audios[0] : undefined;
  if (typeof first !== 'string' || first.length === 0) throw new VoiceError('bad_audio', 'Sarvam answered without audio. Nothing was saved.');
  const audio = Buffer.from(first, 'base64');
  if (audio.length === 0 || audio.length > MAX_CLIP_BYTES) throw new VoiceError('bad_audio', 'Sarvam sent audio of an unexpected size. Nothing was saved.');
  const format = audioFormatOf(audio);
  if (!format) throw new VoiceError('bad_audio', 'Sarvam sent something that is not MP3 or WAV audio. Nothing was saved.');
  return { audio, format, voice, model: choice.model };
}
