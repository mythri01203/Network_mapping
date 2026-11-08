import { createHash, randomBytes, scrypt, type ScryptOptions, timingSafeEqual } from 'node:crypto';

/**
 * Passwords are stored only as scrypt hashes (`node:crypto`, no extra package): a random salt per
 * password and the cost settings in the stored string, so they can be raised later without
 * breaking older hashes. Session tokens are random and only their SHA-256 is stored, so a copy of
 * the database cannot be used to log in. Neither is ever written to a log.
 */

const KEY_LENGTH = 64;
const COST = { N: 2 ** 15, r: 8, p: 1 } as const;
/** scrypt needs 128 × N × r bytes; leave room for it. */
const MAX_MEMORY = 128 * COST.N * COST.r * 2;

const scryptAsync = (password: string, salt: Buffer, keyLength: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, keyLength, options, (error, key) => (error ? reject(error) : resolve(key)));
  });

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LENGTH, { ...COST, maxmem: MAX_MEMORY });
  return `scrypt$${COST.N}$${COST.r}$${COST.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** True when the password matches. Unreadable stored values never match. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltText, keyText] = parts;
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  if (![N, R, P].every((x) => Number.isInteger(x) && x > 0) || N > 2 ** 20) return false;
  const expected = Buffer.from(keyText, 'base64');
  if (expected.length === 0) return false;
  const actual = await scryptAsync(password, Buffer.from(saltText, 'base64'), expected.length, { N, r: R, p: P, maxmem: 128 * N * R * 2 });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A stored hash to compare against when the login name does not exist, so timing does not tell. */
let decoy: Promise<string> | undefined;
export const decoyHash = (): Promise<string> => (decoy ??= hashPassword(randomBytes(12).toString('hex')));

export const newSessionToken = (): string => randomBytes(32).toString('base64url');

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** A temporary password an admin can read out: no look-alike characters. */
export function temporaryPassword(length = 10): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
