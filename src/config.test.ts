import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {};
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function setValidEnv() {
    process.env.PORT = '3000';
    process.env.HOST = '0.0.0.0';
    process.env.NODE_ENV = 'development';
    process.env.LOG_LEVEL = 'info';
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/notification_hub';
    process.env.KAFKA_BROKERS = 'localhost:19092';
    process.env.KAFKA_GROUP_ID = 'notification-hub';
    process.env.KAFKA_TOPICS = 'events.*';
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.RESEND_FROM = 'test@example.com';
    process.env.API_KEYS = 'key-1,key-2';
    process.env.ADMIN_API_KEY = 'admin-key';
    process.env.DEFAULT_TENANT_ID = 'default';
    process.env.DEDUP_WINDOW_MINUTES = '60';
    process.env.DIGEST_SCHEDULE = 'daily';
    process.env.QUIET_HOURS_CHECK_INTERVAL_MS = '900000';
    process.env.NOTIFICATION_RETENTION_DAYS = '90';
  }

  it('parses valid environment variables correctly', () => {
    setValidEnv();
    const config = loadConfig();

    expect(config.PORT).toBe(3000);
    expect(config.HOST).toBe('0.0.0.0');
    expect(config.NODE_ENV).toBe('development');
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.DATABASE_URL).toBe('postgresql://postgres:postgres@localhost:5432/notification_hub');
    expect(config.KAFKA_BROKERS).toEqual(['localhost:19092']);
    expect(config.KAFKA_GROUP_ID).toBe('notification-hub');
    expect(config.KAFKA_TOPICS).toBe('events.*');
    expect(config.RESEND_API_KEY).toBe('re_test_key');
    expect(config.RESEND_FROM).toBe('test@example.com');
    expect(config.API_KEYS).toEqual(['key-1', 'key-2']);
    expect(config.ADMIN_API_KEY).toBe('admin-key');
    expect(config.DEFAULT_TENANT_ID).toBe('default');
    expect(config.DEDUP_WINDOW_MINUTES).toBe(60);
    expect(config.DIGEST_SCHEDULE).toBe('daily');
    expect(config.QUIET_HOURS_CHECK_INTERVAL_MS).toBe(900000);
    expect(config.NOTIFICATION_RETENTION_DAYS).toBe(90);
  });

  it('applies default values when optional vars are omitted', () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test';
    process.env.KAFKA_BROKERS = 'localhost:19092';
    process.env.API_KEYS = 'key-1';
    process.env.ADMIN_API_KEY = 'admin-key';

    const config = loadConfig();

    expect(config.PORT).toBe(3000);
    expect(config.HOST).toBe('0.0.0.0');
    expect(config.NODE_ENV).toBe('development');
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.KAFKA_GROUP_ID).toBe('notification-hub');
    expect(config.KAFKA_TOPICS).toBe('events.*');
    expect(config.DEFAULT_TENANT_ID).toBe('default');
    expect(config.DEDUP_WINDOW_MINUTES).toBe(60);
    expect(config.DIGEST_SCHEDULE).toBe('daily');
    expect(config.QUIET_HOURS_CHECK_INTERVAL_MS).toBe(900000);
    expect(config.NOTIFICATION_RETENTION_DAYS).toBe(90);
    expect(config.RESEND_API_KEY).toBeUndefined();
    expect(config.RESEND_FROM).toBeUndefined();
  });

  it('throws when DATABASE_URL is missing', () => {
    process.env.KAFKA_BROKERS = 'localhost:19092';
    process.env.RESEND_API_KEY = 're_key';
    process.env.RESEND_FROM = 'test@example.com';
    process.env.API_KEYS = 'key-1';
    process.env.ADMIN_API_KEY = 'admin-key';

    expect(() => loadConfig()).toThrow();
  });

  it('throws when KAFKA_BROKERS is missing', () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test';
    process.env.RESEND_API_KEY = 're_key';
    process.env.RESEND_FROM = 'test@example.com';
    process.env.API_KEYS = 'key-1';
    process.env.ADMIN_API_KEY = 'admin-key';

    expect(() => loadConfig()).toThrow();
  });

  it('accepts missing RESEND_API_KEY as optional (per-tenant config fallback)', () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test';
    process.env.KAFKA_BROKERS = 'localhost:19092';
    process.env.RESEND_FROM = 'test@example.com';
    process.env.API_KEYS = 'key-1';
    process.env.ADMIN_API_KEY = 'admin-key';

    const config = loadConfig();
    expect(config.RESEND_API_KEY).toBeUndefined();
  });

  it('accepts missing RESEND_FROM as optional (per-tenant config fallback)', () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test';
    process.env.KAFKA_BROKERS = 'localhost:19092';
    process.env.RESEND_API_KEY = 're_key';
    process.env.API_KEYS = 'key-1';
    process.env.ADMIN_API_KEY = 'admin-key';

    const config = loadConfig();
    expect(config.RESEND_FROM).toBeUndefined();
  });

  it('throws when API_KEYS is missing', () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test';
    process.env.KAFKA_BROKERS = 'localhost:19092';
    process.env.RESEND_API_KEY = 're_key';
    process.env.RESEND_FROM = 'test@example.com';
    process.env.ADMIN_API_KEY = 'admin-key';

    expect(() => loadConfig()).toThrow();
  });

  it('throws when ADMIN_API_KEY is missing', () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test';
    process.env.KAFKA_BROKERS = 'localhost:19092';
    process.env.RESEND_API_KEY = 're_key';
    process.env.RESEND_FROM = 'test@example.com';
    process.env.API_KEYS = 'key-1';

    expect(() => loadConfig()).toThrow();
  });

  it('throws when PORT is non-numeric', () => {
    setValidEnv();
    process.env.PORT = 'not-a-number';

    expect(() => loadConfig()).toThrow();
  });

  it('throws when DEDUP_WINDOW_MINUTES is non-numeric', () => {
    setValidEnv();
    process.env.DEDUP_WINDOW_MINUTES = 'abc';

    expect(() => loadConfig()).toThrow();
  });

  it('throws when DIGEST_SCHEDULE has invalid value', () => {
    setValidEnv();
    process.env.DIGEST_SCHEDULE = 'monthly';

    expect(() => loadConfig()).toThrow();
  });

  it('parses multiple KAFKA_BROKERS correctly', () => {
    setValidEnv();
    process.env.KAFKA_BROKERS = 'broker1:9092,broker2:9092,broker3:9092';

    const config = loadConfig();

    expect(config.KAFKA_BROKERS).toEqual(['broker1:9092', 'broker2:9092', 'broker3:9092']);
  });

  it('parses multiple API_KEYS correctly', () => {
    setValidEnv();
    process.env.API_KEYS = 'key-a,key-b,key-c';

    const config = loadConfig();

    expect(config.API_KEYS).toEqual(['key-a', 'key-b', 'key-c']);
  });
});
