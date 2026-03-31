import { describe, it, expect } from 'vitest';
import { kafkaEventSchema } from './kafka.js';

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
