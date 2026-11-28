import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** AES-256-GCM: iv | tag | ciphertext, base64url. The kid says which key decrypts it. */
export function seal(keys: Array<{ kid: string; key: Buffer }>, plaintext: string): { kid: string; value: string } {
  const { kid, key } = keys[0]!;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { kid, value: Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url') };
}

export function open(keys: Array<{ kid: string; key: Buffer }>, kid: string, value: string): string {
  const k = keys.find((x) => x.kid === kid);
  if (!k) throw new Error(`No session key '${kid}'`);
  const raw = Buffer.from(value, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', k.key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

/** A 256-bit random identifier, base64url. */
export const randomId = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('base64url');
