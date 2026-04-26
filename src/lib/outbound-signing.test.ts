import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  canonicalJson,
  signOutboundPayload,
  buildSignedOutboundRequest,
} from './outbound-signing.js';

// Phase 7 7b — shared HMAC outbound signing tests. Mirrors the determinism
// + tamper-detection contract exercised by `delivery-callback.test.ts` but
// proves the canonical-JSON / signing primitives are byte-stable
// independent of the DeliveryCallbackEvent shape.
describe('canonicalJson', () => {
  it('produces byte-identical output regardless of key order', () => {
    const a = canonicalJson({ b: 2, a: 1, c: { y: 'y', x: 'x' } });
    const b = canonicalJson({ a: 1, c: { x: 'x', y: 'y' }, b: 2 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":1,"b":2,"c":{"x":"x","y":"y"}}');
  });

  it('handles nested arrays and primitives', () => {
    const out = canonicalJson({ list: [3, 2, 1], n: null, b: true, s: 'hi' });
    expect(out).toBe('{"b":true,"list":[3,2,1],"n":null,"s":"hi"}');
  });
});

describe('signOutboundPayload', () => {
  it('is deterministic for the same payload + secret', () => {
    const payload = { event_type: 'email.delivered', email_id: 'e_123' };
    const secret = 'a'.repeat(64);
    expect(signOutboundPayload(payload, secret)).toBe(
      signOutboundPayload(payload, secret),
    );
  });

  it('produces a different digest for different secrets on the same payload', () => {
    const payload = { event_type: 'email.bounced', email_id: 'e_xyz' };
    const a = signOutboundPayload(payload, 'a'.repeat(64));
    const b = signOutboundPayload(payload, 'b'.repeat(64));
    expect(a).not.toBe(b);
    // Both are 64-char lowercase hex
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches an externally-computed HMAC-SHA256 over the canonical bytes', () => {
    const payload = { z: 1, a: 2 };
    const secret = 'topsecret';
    const expected = crypto
      .createHmac('sha256', secret)
      .update('{"a":2,"z":1}') // canonical form
      .digest('hex');
    expect(signOutboundPayload(payload, secret)).toBe(expected);
  });
});

describe('buildSignedOutboundRequest', () => {
  it('returns canonical body and matching sha256= header', () => {
    const payload = { event: 'x', data: { b: 2, a: 1 } };
    const secret = 'a'.repeat(64);
    const { body, signatureHeader } = buildSignedOutboundRequest(payload, secret);
    expect(body).toBe('{"data":{"a":1,"b":2},"event":"x"}');
    expect(signatureHeader.startsWith('sha256=')).toBe(true);

    // Tenant-side verification: HMAC the body bytes with same secret → match
    const recomputed = 'sha256=' +
      crypto.createHmac('sha256', secret).update(body).digest('hex');
    expect(signatureHeader).toBe(recomputed);
  });

  it('produces a different signature when the payload is tampered', () => {
    const secret = 'a'.repeat(64);
    const { signatureHeader: a } = buildSignedOutboundRequest({ x: 1 }, secret);
    const { signatureHeader: b } = buildSignedOutboundRequest({ x: 2 }, secret);
    expect(a).not.toBe(b);
  });
});
