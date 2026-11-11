import { useEffect } from 'react';
import { CircleAlert, Pause, Play, RotateCcw, Square, Volume2, WifiOff } from 'lucide-react';

import { isVoiceLanguage } from '@fibergis/shared';

import { useT } from '../../i18n/useT';
import { useAuthStore } from '../../stores/authStore';
import { clipFor, useVoiceLibrary } from './voiceLibrary';
import { useVoicePlayer } from './voicePlayer';

const BIG = 'flex min-h-[64px] min-w-[64px] items-center justify-center gap-2 rounded-2xl border-2 px-4 text-[17px] font-bold';

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

/**
 * Voice for one lesson step, in the chosen language only. Plays when tapped, never by itself. With
 * no clip in that language it says so and the words stay on screen; it never plays another
 * language's voice instead.
 */
export function VoiceGuidePlayer({ lessonKey }: { lessonKey: string }) {
  const { t, lang } = useT();
  const library = useVoiceLibrary();
  const mode = useAuthStore((s) => s.mode);
  const role = useAuthStore((s) => s.account?.role);
  const player = useVoicePlayer();
  const allowDrafts = mode === 'setup' || role === 'admin';

  useEffect(() => {
    void useVoiceLibrary.getState().load();
  }, []);
  // A new step or language: the old voice stops.
  useEffect(() => () => useVoicePlayer.getState().stop(), [lessonKey, lang]);

  const clip = isVoiceLanguage(lang) ? clipFor(library.clips, lessonKey, lang, allowDrafts) : undefined;
  const mine = !!clip && player.clipId === clip.id;
  const phase = mine ? player.phase : 'idle';
  const progress = mine && player.duration > 0 ? Math.min(1, player.current / player.duration) : 0;

  if (!clip) {
    return (
      <p role="status" data-testid="voice-missing" className="flex items-start gap-2 rounded-2xl border-2 border-slate-300 bg-slate-50 p-3 text-[16px] font-semibold text-slate-800">
        {library.state === 'offline' ? <WifiOff className="mt-0.5 h-6 w-6 shrink-0" aria-hidden /> : <Volume2 className="mt-0.5 h-6 w-6 shrink-0 text-slate-500" aria-hidden />}
        {library.state === 'offline' ? t('learn.offline') : t('learn.noVoice')}
      </p>
    );
  }

  const playing = phase === 'playing' || phase === 'loading';
  return (
    <div className="space-y-2" data-testid="voice-player" data-phase={phase}>
      {clip.status === 'draft' && (
        <p data-testid="voice-draft" className="rounded-xl bg-amber-50 px-3 py-1.5 text-[15px] font-semibold text-amber-900 ring-1 ring-amber-300">
          {t('learn.voiceDraft')}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid={playing ? 'voice-pause' : 'voice-play'}
          onClick={() => (playing ? player.pause() : phase === 'paused' ? player.resume() : player.play(clip.id))}
          className={`${BIG} ui-brand border-blue-800 bg-blue-700 text-white`}
        >
          {playing ? <Pause className="h-7 w-7" aria-hidden /> : <Play className="h-7 w-7" aria-hidden />}
          {playing ? t('learn.pause') : phase === 'paused' ? t('learn.resume') : t('learn.play')}
        </button>
        <button type="button" data-testid="voice-repeat" disabled={!mine} onClick={() => player.repeat()} className={`${BIG} border-slate-400 bg-white text-slate-900 disabled:opacity-40`}>
          <RotateCcw className="h-6 w-6" aria-hidden />
          {t('learn.repeat')}
        </button>
        <button type="button" data-testid="voice-stop" disabled={!mine || phase === 'idle'} onClick={() => player.stop()} className={`${BIG} border-slate-400 bg-white text-slate-900 disabled:opacity-40`}>
          <Square className="h-6 w-6" aria-hidden />
          {t('learn.stop')}
        </button>
      </div>
      <div className="flex items-center gap-2" aria-hidden>
        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full rounded-full bg-blue-600 transition-[width] duration-200" style={{ width: `${progress * 100}%` }} />
        </div>
        <span className="tabular w-20 text-right text-[14px] text-slate-600">
          {mine && player.duration > 0 ? `${clock(player.current)} / ${clock(player.duration)}` : ''}
        </span>
      </div>
      {phase === 'error' && (
        <p role="alert" data-testid="voice-error" className="flex items-start gap-2 text-[16px] font-semibold text-red-800">
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          {t('learn.voiceError')}
        </p>
      )}
    </div>
  );
}
