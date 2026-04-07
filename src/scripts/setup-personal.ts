import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });

import crypto from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import {
  tenants,
  templates,
  notificationRules,
  userPreferences,
} from '../db/schema.js';
import { createDb, type Database } from '../db/client.js';

// ─── Types ──────────────────────────────────────────────────────────

export interface PersonalEnv {
  KINGSLEY_RESEND_KEY: string;
  KINGSLEY_RESEND_FROM: string;
  KINGSLEY_TELEGRAM_BOT_TOKEN: string;
  KINGSLEY_TELEGRAM_BOT_USERNAME: string;
  KINGSLEY_EMAIL: string;
}

export interface SetupResult {
  tenantId: string;
  apiKey: string;
  rulesCreated: number;
  templatesCreated: number;
  preferencesCreated: number;
}

const TENANT_ID = 'kingsley';

// ─── Core setup function ────────────────────────────────────────────

export async function setupPersonalTenant(
  db: Database,
  env: PersonalEnv,
): Promise<SetupResult> {
  // 1. Upsert tenant
  const apiKey = await upsertTenant(db, env);

  // 2. Upsert templates (must come before rules for FK)
  const templatesCreated = await upsertTemplates(db);

  // 3. Upsert rules
  const rulesCreated = await upsertRules(db);

  // 4. Upsert preferences
  const preferencesCreated = await upsertPreferences(db, env.KINGSLEY_EMAIL);

  return {
    tenantId: TENANT_ID,
    apiKey,
    rulesCreated,
    templatesCreated,
    preferencesCreated,
  };
}

// ─── Tenant ─────────────────────────────────────────────────────────

async function upsertTenant(db: Database, env: PersonalEnv): Promise<string> {
  const config = {
    channels: {
      email: { apiKey: env.KINGSLEY_RESEND_KEY, from: env.KINGSLEY_RESEND_FROM },
      telegram: {
        botToken: env.KINGSLEY_TELEGRAM_BOT_TOKEN,
        botUsername: env.KINGSLEY_TELEGRAM_BOT_USERNAME,
      },
    },
  };

  const [existing] = await db
    .select({ apiKey: tenants.apiKey })
    .from(tenants)
    .where(eq(tenants.id, TENANT_ID))
    .limit(1);

  if (existing) {
    await db
      .update(tenants)
      .set({ name: 'Kingsley Personal', config, updatedAt: new Date() })
      .where(eq(tenants.id, TENANT_ID));
    return existing.apiKey;
  }

  const apiKey = `nhk_${crypto.randomBytes(24).toString('hex')}`;
  await db.insert(tenants).values({
    id: TENANT_ID,
    name: 'Kingsley Personal',
    apiKey,
    config,
  });
  return apiKey;
}

// ─── Templates ──────────────────────────────────────────────────────

const TEMPLATE_DEFS = [
  {
    name: 'task-assigned-email',
    channel: 'email' as const,
    subject: 'Task Assigned: {{task.name}}',
    body: 'Hi,\n\nYou have been assigned a new task: {{task.name}}\n\nDescription: {{task.description}}\nPriority: {{task.priority}}\n\nView task: {{task.url}}',
  },
  {
    name: 'task-assigned-telegram',
    channel: 'telegram' as const,
    subject: null,
    body: '📋 Task: {{task.name}} assigned to you\nPriority: {{task.priority}}',
  },
  {
    name: 'deploy-completed-telegram',
    channel: 'telegram' as const,
    subject: null,
    body: '🚀 Deploy: {{project}} deployed to {{environment}}\nStatus: {{status}}',
  },
  {
    name: 'alert-triggered-email',
    channel: 'email' as const,
    subject: 'Alert: {{alert.name}}',
    body: 'Alert triggered: {{alert.name}}\n\nMessage: {{alert.message}}\nSeverity: {{alert.severity}}\nSource: {{alert.source}}\nTime: {{alert.timestamp}}',
  },
  {
    name: 'alert-triggered-telegram',
    channel: 'telegram' as const,
    subject: null,
    body: '🚨 {{alert.name}}: {{alert.message}}',
  },
  {
    name: '__digest',
    channel: 'email' as const,
    subject: 'Your notification digest',
    body: '<h2>Notification Digest</h2>\n<p>You have {{count}} notifications:</p>\n<ul>\n{{#each notifications}}\n  <li><strong>{{this.subject}}</strong> — {{this.body}}</li>\n{{/each}}\n</ul>\n{{#if truncated}}\n<p>...and {{remaining_count}} more.</p>\n{{/if}}',
  },
];

async function upsertTemplates(db: Database): Promise<number> {
  let count = 0;
  for (const def of TEMPLATE_DEFS) {
    const [existing] = await db
      .select({ id: templates.id })
      .from(templates)
      .where(and(eq(templates.tenantId, TENANT_ID), eq(templates.name, def.name)))
      .limit(1);

    if (existing) {
      await db
        .update(templates)
        .set({
          channel: def.channel,
          subject: def.subject,
          body: def.body,
          updatedAt: new Date(),
        })
        .where(eq(templates.id, existing.id));
    } else {
      await db.insert(templates).values({
        tenantId: TENANT_ID,
        name: def.name,
        channel: def.channel,
        subject: def.subject,
        body: def.body,
      });
    }
    count++;
  }
  return count;
}

// ─── Rules ──────────────────────────────────────────────────────────

interface RuleDef {
  eventType: string;
  channel: 'email' | 'telegram';
  templateName: string;
}

const RULE_DEFS: RuleDef[] = [
  { eventType: 'task.assigned', channel: 'email', templateName: 'task-assigned-email' },
  { eventType: 'task.assigned', channel: 'telegram', templateName: 'task-assigned-telegram' },
  { eventType: 'deploy.completed', channel: 'telegram', templateName: 'deploy-completed-telegram' },
  { eventType: 'alert.triggered', channel: 'email', templateName: 'alert-triggered-email' },
  { eventType: 'alert.triggered', channel: 'telegram', templateName: 'alert-triggered-telegram' },
];

async function upsertRules(db: Database): Promise<number> {
  // Load template IDs by name for this tenant
  const tpls = await db
    .select({ id: templates.id, name: templates.name })
    .from(templates)
    .where(eq(templates.tenantId, TENANT_ID));
  const tplByName = new Map(tpls.map((t) => [t.name, t.id]));

  let count = 0;
  for (const def of RULE_DEFS) {
    const templateId = tplByName.get(def.templateName);
    if (!templateId) {
      throw new Error(`Template not found: ${def.templateName}`);
    }

    const [existing] = await db
      .select({ id: notificationRules.id })
      .from(notificationRules)
      .where(and(
        eq(notificationRules.tenantId, TENANT_ID),
        eq(notificationRules.eventType, def.eventType),
        eq(notificationRules.channel, def.channel),
      ))
      .limit(1);

    if (existing) {
      await db
        .update(notificationRules)
        .set({ templateId, updatedAt: new Date() })
        .where(eq(notificationRules.id, existing.id));
    } else {
      await db.insert(notificationRules).values({
        tenantId: TENANT_ID,
        eventType: def.eventType,
        channel: def.channel,
        templateId,
        recipientType: 'event_field',
        recipientValue: 'recipient.id',
      });
    }
    count++;
  }
  return count;
}

// ─── Preferences ────────────────────────────────────────────────────

async function upsertPreferences(
  db: Database,
  email: string,
): Promise<number> {
  const [existing] = await db
    .select({ id: userPreferences.id })
    .from(userPreferences)
    .where(and(eq(userPreferences.tenantId, TENANT_ID), eq(userPreferences.userId, 'kingsley')))
    .limit(1);

  if (existing) {
    await db
      .update(userPreferences)
      .set({ email, updatedAt: new Date() })
      .where(eq(userPreferences.id, existing.id));
  } else {
    await db.insert(userPreferences).values({
      tenantId: TENANT_ID,
      userId: 'kingsley',
      email,
      digestMode: false,
    });
  }
  return 1;
}

// ─── CLI entry point ────────────────────────────────────────────────

function loadPersonalEnv(): PersonalEnv {
  const required = [
    'KINGSLEY_RESEND_KEY',
    'KINGSLEY_RESEND_FROM',
    'KINGSLEY_TELEGRAM_BOT_TOKEN',
    'KINGSLEY_TELEGRAM_BOT_USERNAME',
    'KINGSLEY_EMAIL',
  ] as const;

  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`Missing required environment variables:\n  ${missing.join('\n  ')}`);
    console.error('\nSet them in .env.local or pass them as environment variables.');
    process.exit(1);
  }

  return {
    KINGSLEY_RESEND_KEY: process.env.KINGSLEY_RESEND_KEY!,
    KINGSLEY_RESEND_FROM: process.env.KINGSLEY_RESEND_FROM!,
    KINGSLEY_TELEGRAM_BOT_TOKEN: process.env.KINGSLEY_TELEGRAM_BOT_TOKEN!,
    KINGSLEY_TELEGRAM_BOT_USERNAME: process.env.KINGSLEY_TELEGRAM_BOT_USERNAME!,
    KINGSLEY_EMAIL: process.env.KINGSLEY_EMAIL!,
  };
}

const isDirectRun =
  process.argv[1]?.endsWith('setup-personal.ts') ||
  process.argv[1]?.endsWith('setup-personal.js');

if (isDirectRun) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('Missing DATABASE_URL. Set it in .env.local.');
    process.exit(1);
  }

  const env = loadPersonalEnv();
  const { db: scriptDb, sql: scriptSql } = createDb(databaseUrl);

  setupPersonalTenant(scriptDb, env)
    .then((result) => {
      console.log('\n✅ Personal tenant created');
      console.log(`Tenant ID: ${result.tenantId}`);
      console.log(`API Key: ${result.apiKey}`);
      console.log(`\nRules: ${result.rulesCreated} created`);
      console.log(`Templates: ${result.templatesCreated} created`);
      console.log(`Preferences: ${result.preferencesCreated} created`);
      console.log('\nNext steps:');
      console.log('1. Use API key in X-API-Key header for all requests');
      console.log('2. Run: POST /api/preferences/kingsley/telegram/link to connect Telegram');
      console.log('3. Test: POST /api/events with your API key');
      return scriptSql.end();
    })
    .catch((err) => {
      console.error('Setup failed:', err.message);
      process.exit(1);
    });
}
