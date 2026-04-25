import crypto from 'node:crypto';

/**
 * Resend webhook signature verification (Svix scheme).
 *
 * Resend signs webhooks via Svix. The signing scheme:
 *   1. Decode the secret: `secret_bytes = base64decode(secret without "whsec_" prefix)`
 *   2. Sign the canonical content: `${svix_id}.${svix_timestamp}.${rawBody}`
 *      with HMAC-SHA256 using the decoded secret bytes.
 *   3. The `svix-signature` header carries `v1,<base64(signature)>` — possibly
 *      multiple comma-separated entries (e.g. during key rotation). Any one
 *      matching `v1,*` entry is sufficient.
 *
 * Reference: https://docs.svix.com/receiving/verifying-payloads/how-manual
 *
 * Returns `true` only if all three headers are present, the timestamp is
 * within the allowed skew window, AND the computed signature equals at
 * least one `v1,*` entry from the header (constant-time compared).
 *
 * NEVER throws — invalid input → returns `false`.
 */
export function verifyResendSignature(
  rawBody: string,
  headers: Record<string, string | undefined>,
  secret: string,
): boolean {
  const svixId = headers['svix-id'];
  const svixTimestamp = headers['svix-timestamp'];
  const svixSignature = headers['svix-signature'];

  if (!svixId || !svixTimestamp || !svixSignature) {
    return false;
  }

  // Reject stale or far-future timestamps (5 min skew window).
  const ts = Number.parseInt(svixTimestamp, 10);
  if (!Number.isFinite(ts)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  const skewSec = 5 * 60;
  if (Math.abs(nowSec - ts) > skewSec) return false;

  // Decode whsec secret. Tolerate the `whsec_` prefix Svix uses by convention.
  let secretBytes: Buffer;
  try {
    secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  } catch {
    return false;
  }
  if (secretBytes.length === 0) return false;

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expectedSig = crypto
    .createHmac('sha256', secretBytes)
    .update(signedContent)
    .digest('base64');

  // Header may carry multiple space-separated `v1,<sig>` entries — any match wins.
  const candidates = svixSignature.split(' ').map((s) => s.trim()).filter(Boolean);
  for (const candidate of candidates) {
    const [version, sig] = candidate.split(',');
    if (version !== 'v1' || !sig) continue;
    if (constantTimeEqualBase64(sig, expectedSig)) return true;
  }

  return false;
}

/** Constant-time compare of two base64 strings; returns false on length mismatch. */
function constantTimeEqualBase64(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}
