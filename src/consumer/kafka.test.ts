import { describe, it, expect } from 'vitest';
import { kafkaEventSchema, type MessageHandler } from './kafka.js';

describe('MessageHandler type', () => {
  it('accepts a handler with tenant record as fourth parameter', () => {
    // This is a compile-time check — if MessageHandler doesn't accept
    // a tenant parameter, TypeScript will fail to compile this test.
    const handler: MessageHandler = async (_event, _rules, _recipients, tenant) => {
      // Verify the tenant parameter shape is accessible
      if (tenant) {
        expect(typeof tenant.id).toBe('string');
        expect(typeof tenant.config).toBe('object');
      }
    };
    expect(handler).toBeDefined();
  });
});

describe('kafkaEventSchema', () => {
  it('accepts valid event', () => {
    const result = kafkaEventSchema.safeParse({
      tenant_id: 'default',
      event_type: 'order.completed',
      event_id: 'evt-123',
      payload: { orderId: '999' },
      timestamp: '2026-03-31T12:00:00Z',
    });

    expect(result.success).toBe(true);
  });

  it('rejects missing tenant_id', () => {
    const result = kafkaEventSchema.safeParse({
      event_type: 'order.completed',
      event_id: 'evt-123',
      payload: {},
      timestamp: '2026-03-31T12:00:00Z',
    });

    expect(result.success).toBe(false);
  });

  it('rejects missing event_type', () => {
    const result = kafkaEventSchema.safeParse({
      tenant_id: 'default',
      event_id: 'evt-123',
      payload: {},
      timestamp: '2026-03-31T12:00:00Z',
    });

    expect(result.success).toBe(false);
  });

  it('rejects missing event_id', () => {
    const result = kafkaEventSchema.safeParse({
      tenant_id: 'default',
      event_type: 'order.completed',
      payload: {},
      timestamp: '2026-03-31T12:00:00Z',
    });

    expect(result.success).toBe(false);
  });

  it('rejects missing payload', () => {
    const result = kafkaEventSchema.safeParse({
      tenant_id: 'default',
      event_type: 'order.completed',
      event_id: 'evt-123',
      timestamp: '2026-03-31T12:00:00Z',
    });

    expect(result.success).toBe(false);
  });

  it('rejects empty tenant_id', () => {
    const result = kafkaEventSchema.safeParse({
      tenant_id: '',
      event_type: 'order.completed',
      event_id: 'evt-123',
      payload: {},
      timestamp: '2026-03-31T12:00:00Z',
    });

    expect(result.success).toBe(false);
  });
});
