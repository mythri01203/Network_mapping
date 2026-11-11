import { beforeEach, describe, expect, it } from 'vitest';

import { LESSON_SCRIPTS, type VoiceClip, WELCOME_LESSON } from '@fibergis/shared';

import { useLearnStore } from './learnStore';
import { clipFor } from './voiceLibrary';
import { type AudioLike, setAudioFactory, useVoicePlayer } from './voicePlayer';

const clip = (over: Partial<VoiceClip>): VoiceClip => ({
  id: 'VC-AAAAAAAAAA',
  lessonKey: 'welcome.intro',
  language: 'te',
  scriptHash: 'h',
  model: 'bulbul:v4-flash',
  voice: 'kavitha_te_conversation',
  characters: 100,
  bytes: 1000,
  format: 'mp3',
  status: 'approved',
  createdAt: '2026-11-10T00:00:00.000Z',
  createdBy: null,
  ...over,
});

describe('which voice clip plays', () => {
  it('plays only the chosen language, never English instead', () => {
    const clips = [clip({ id: 'VC-EN00000000', language: 'en' })];
    expect(clipFor(clips, 'welcome.intro', 'te', true)).toBeUndefined();
    expect(clipFor(clips, 'welcome.intro', 'en', false)?.id).toBe('VC-EN00000000');
  });

  it('gives drafts only to someone allowed to hear them, and never an outdated or rejected clip', () => {
    const draft = clip({ id: 'VC-DRAFT00000', status: 'draft' });
    expect(clipFor([draft], 'welcome.intro', 'te', false)).toBeUndefined();
    expect(clipFor([draft], 'welcome.intro', 'te', true)?.id).toBe('VC-DRAFT00000');
    expect(clipFor([clip({ outdated: true })], 'welcome.intro', 'te', true)).toBeUndefined();
    expect(clipFor([clip({ status: 'rejected' })], 'welcome.intro', 'te', true)).toBeUndefined();
    expect(clipFor([draft, clip({ id: 'VC-OK00000000' })], 'welcome.intro', 'te', true)?.id).toBe('VC-OK00000000');
  });
});

class FakeAudio implements AudioLike {
  src = '';
  currentTime = 0;
  duration = 12;
  paused = true;
  plays = 0;
  fail = false;
  private listeners = new Map<string, (() => void)[]>();
  addEventListener(type: string, fn: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener() {}
  emit(type: string) {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }
  async play() {
    this.plays += 1;
    if (this.fail) throw new Error('blocked');
    this.paused = false;
    this.emit('playing');
  }
  pause() {
    this.paused = true;
    this.emit('pause');
  }
}

describe('voice player', () => {
  let audio: FakeAudio;
  beforeEach(() => {
    audio = new FakeAudio();
    setAudioFactory(() => audio);
    useVoicePlayer.setState({ clipId: null, phase: 'idle', current: 0, duration: 0 });
  });

  it('plays, pauses, resumes, repeats and stops one clip from the server', async () => {
    const p = useVoicePlayer.getState();
    p.play('VC-AAAAAAAAAA');
    await Promise.resolve();
    expect(audio.src).toContain('/api/v1/voice/audio/VC-AAAAAAAAAA');
    expect(useVoicePlayer.getState().phase).toBe('playing');
    p.pause();
    expect(useVoicePlayer.getState().phase).toBe('paused');
    p.resume();
    await Promise.resolve();
    expect(useVoicePlayer.getState().phase).toBe('playing');
    audio.currentTime = 7;
    p.repeat();
    expect(audio.currentTime).toBe(0);
    p.stop();
    expect(useVoicePlayer.getState().phase).toBe('idle');
    expect(audio.paused).toBe(true);
  });

  it('says so when the browser will not play', async () => {
    audio.fail = true;
    useVoicePlayer.getState().play('VC-AAAAAAAAAA');
    await Promise.resolve();
    await Promise.resolve();
    expect(useVoicePlayer.getState().phase).toBe('error');
  });
});

describe('welcome lesson', () => {
  it('has words in all three languages for every step, with Telugu and Kannada marked as drafts', () => {
    for (const key of WELCOME_LESSON) {
      const script = LESSON_SCRIPTS.find((s) => s.key === key)!;
      expect(script).toBeTruthy();
      for (const lang of ['en', 'te', 'kn'] as const) expect(script.text[lang].text.length).toBeGreaterThan(20);
      expect(script.text.en.reviewed).toBe(true);
      expect(script.text.te.reviewed).toBe(false);
      expect(script.text.kn.reviewed).toBe(false);
    }
  });

  it('opens once on a new device and is remembered as seen after Skip', () => {
    useLearnStore.setState({ welcomeSeen: false, welcomeOpen: false, welcomeStep: 3 });
    useLearnStore.getState().openWelcome();
    expect(useLearnStore.getState()).toMatchObject({ welcomeOpen: true, welcomeStep: 0 });
    useLearnStore.getState().closeWelcome();
    expect(useLearnStore.getState()).toMatchObject({ welcomeOpen: false, welcomeSeen: true });
  });
});
