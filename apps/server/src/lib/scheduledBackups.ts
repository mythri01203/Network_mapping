import { createBackup } from '@fibergis/shared';

import type { NetworkRepository } from '../db/repository';
import { buildBackupZip, writeSafetyCopy } from './backups';

/**
 * Phase 24: a backup every few hours (`BACKUP_EVERY_HOURS`; off by default), in the same zip format
 * as the safety copies (`backup.json` plus every photo), saved in the backups folder as
 * `fibergis-scheduled-<time>.zip`. The newest `BACKUP_KEEP` scheduled copies are kept, counted apart
 * from the copies made before a reset or restore. When nothing changed since the last scheduled copy
 * this server made, none is written.
 */
export interface ScheduledBackupOptions {
  repository: Pick<NetworkRepository, 'getNetwork' | 'getRevision'>;
  everyHours: number;
  keep: number;
  backupsDir: string;
  photosDir: string;
  log: { info: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };
}

export interface ScheduledBackups {
  /** Makes one copy now (if anything changed). The file name, or null when skipped. */
  runOnce(): Promise<string | null>;
  stop(): void;
}

export function startScheduledBackups(options: ScheduledBackupOptions): ScheduledBackups {
  let lastRevision: number | null = null;
  let running: Promise<string | null> | null = null;
  const runOnce = async (): Promise<string | null> => {
    if (running) return running;
    running = (async () => {
      try {
        if (lastRevision !== null && (await options.repository.getRevision()) === lastRevision) return null;
        const { revision, data } = await options.repository.getNetwork();
        const { zip, photos } = await buildBackupZip(JSON.stringify(createBackup(data, new Date().toISOString())), options.photosDir);
        const name = await writeSafetyCopy(options.backupsDir, zip, 'scheduled', options.keep);
        lastRevision = revision;
        options.log.info({ file: name, photos, revision }, 'Scheduled backup saved');
        return name;
      } catch (error) {
        options.log.error({ err: error }, 'Scheduled backup failed; the next one will be tried at the usual time');
        return null;
      } finally {
        running = null;
      }
    })();
    return running;
  };
  const timer = options.everyHours > 0 ? setInterval(() => void runOnce(), options.everyHours * 3_600_000) : undefined;
  timer?.unref?.();
  return {
    runOnce,
    stop: () => clearInterval(timer),
  };
}
