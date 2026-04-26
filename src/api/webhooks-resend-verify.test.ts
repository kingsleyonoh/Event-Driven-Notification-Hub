import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { verifyResendSignature } from './webhooks-resend-verify.js';

/**
 * Resend uses Svix-format webhook signatures. The signing scheme:
 *   1. Decode the secret: secret_bytes = base64decode(secret without "whsec_" prefix)
 *   2. Sign: hmac_sha256(secret_bytes, `${svix_id}.${svix_timestamp}.${rawBody}`)
 *   3. Header value is `v1,${base64(signature)}` — possibly multiple space-separated
 */

function makeSecret(): string {
  // 24 random bytes, base64-encoded, prefixed `whsec_` per Svix convention.
  return 'whsec_' + crypto.randomBytes(24).toString('base64');
}

function signSvix(rawBody: string, svixId: string, timestamp: string, secret: string): string {
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signedContent = `${svixId}.${timestamp}.${rawBody}`;
  const sig = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');
  return `v1,${sig}`;
}

describe('verifyResendSignature', () => {
  it('returns true for a known-good signature against its payload', () => {
    const secret = makeSecret();
    const rawBody = JSON.stringify({ type: 'email.delivered', data: { email_id: 'e_abc' } });
    const svixId = 'msg_2k5Qwertz';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signSvix(rawBody, svixId, timestamp, secret);

    const result = verifyResendSignature(rawBody, {
      'svix-id': svixId,
      'svix-timestamp': timestamp,
      'svix-signature': signature,
    }, secret);

    expect(result).toBe(true);
  });

  it('returns false for a tampered payload (one byte changed)', () => {
    const secret = makeSecret();
    const rawBody = JSON.stringify({ type: 'email.delivered', data: { email_id: 'e_abc' } });
    const svixId = 'msg_tamper';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signSvix(rawBody, svixId, timestamp, secret);

    // Tamper: change one character of the body
    const tamperedBody = rawBody.replace('e_abc', 'e_xyz');

    const result = verifyResendSignature(tamperedBody, {
      'svix-id': svixId,
      'svix-timestamp': timestamp,
      'svix-signature': signature,
    }, secret);

    expect(result).toBe(false);
  });

  it('returns false (does not throw) when svix-signature header is missing or malformed', () => {
    const secret = makeSecret();
    const rawBody = '{}';
    const svixId = 'msg_missing';
    const timestamp = String(Math.floor(Date.now() / 1000));

    // Missing header
    const result1 = verifyResendSignature(rawBody, {
      'svix-id': svixId,
      'svix-timestamp': timestamp,
    }, secret);
    expect(result1).toBe(false);

    // Malformed header (no v1 prefix, no comma)
    const result2 = verifyResendSignature(rawBody, {
      'svix-id': svixId,
      'svix-timestamp': timestamp,
      'svix-signature': 'totally-not-a-valid-signature',
    }, secret);
    expect(result2).toBe(false);

    // Missing svix-id and svix-timestamp
    const result3 = verifyResendSignature(rawBody, {
      'svix-signature': 'v1,abcd',
    }, secret);
    expect(result3).toBe(false);
  });
});
