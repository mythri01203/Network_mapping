/**
 * Counts wrong passwords, in memory. Too many from one address for one login name, or from one
 * address in all, and further tries wait. Keyed by address and name together, so somebody guessing
 * from elsewhere cannot lock the owner out of their own account. A right password clears the count
 * for that address and name. Restarting the server clears everything.
 */
export interface LoginLimits {
  /** Wrong tries allowed for one login name from one address within the window. */
  maxFailures: number;
  windowMs: number;
}

interface Entry {
  failures: number;
  firstAt: number;
  blockedUntil?: number;
}

export class LoginLimiter {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly limits: LoginLimits) {}

  private keys(ip: string, username: string) {
    return [{ key: `name:${ip}|${username}`, max: this.limits.maxFailures }, { key: `ip:${ip}`, max: this.limits.maxFailures * 4 }];
  }

  /** Seconds to wait, or 0 when this login may be tried. */
  retryAfterSeconds(ip: string, username: string, now = Date.now()): number {
    let wait = 0;
    for (const { key } of this.keys(ip, username)) {
      const entry = this.entries.get(key);
      if (!entry) continue;
      if (entry.blockedUntil && entry.blockedUntil > now) wait = Math.max(wait, Math.ceil((entry.blockedUntil - now) / 1000));
      else if (now - entry.firstAt > this.limits.windowMs) this.entries.delete(key);
    }
    return wait;
  }

  failed(ip: string, username: string, now = Date.now()): void {
    for (const { key, max } of this.keys(ip, username)) {
      let entry = this.entries.get(key);
      if (!entry || now - entry.firstAt > this.limits.windowMs) entry = { failures: 0, firstAt: now };
      entry.failures += 1;
      if (entry.failures >= max) entry.blockedUntil = now + this.limits.windowMs;
      this.entries.set(key, entry);
    }
    if (this.entries.size > 10_000) this.prune(now);
  }

  succeeded(ip: string, username: string): void {
    this.entries.delete(`name:${ip}|${username}`);
  }

  private prune(now: number) {
    for (const [key, entry] of this.entries) {
      if ((entry.blockedUntil ?? entry.firstAt + this.limits.windowMs) < now) this.entries.delete(key);
    }
  }
}
