import { describe, it, expect } from 'vitest';
import { resolveRecipient } from './router.js';

describe('resolveRecipient', () => {
  it('returns static value directly', () => {
    const result = resolveRecipient('static', 'admin@example.com', {});
    expect(result).toBe('admin@example.com');
  });

  it('extracts top-level field from payload', () => {
    const result = resolveRecipient('event_field', 'userId', { userId: 'user-123' });
    expect(result).toBe('user-123');
  });

  it('extracts nested field via dot path', () => {
    const result = resolveRecipient('event_field', 'assignee.id', {
      assignee: { id: 'user-456' },
    });
    expect(result).toBe('user-456');
  });

  it('returns null for missing nested path', () => {
    const result = resolveRecipient('event_field', 'assignee.id', {});
    expect(result).toBeNull();
  });

  it('returns null for non-string value at path', () => {
    const result = resolveRecipient('event_field', 'count', { count: 42 });
    expect(result).toBeNull();
  });

  it('returns null for role type (not implemented)', () => {
    const result = resolveRecipient('role', 'admin', { role: 'admin' });
    expect(result).toBeNull();
  });
});
