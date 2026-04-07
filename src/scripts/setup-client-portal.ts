import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });

import crypto from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { createDb } from '../db/client.js';
import { tenants, templates, notificationRules, userPreferences } from '../db/schema.js';

const TENANT_ID = 'client-portal';
const TENANT_NAME = 'Client Management Portal';

interface SetupEnv {
  DATABASE_URL: string;
  RESEND_API_KEY: string;
  RESEND_FROM: string;
  ADMIN_EMAIL: string;
}

function loadEnv(): SetupEnv {
  const DATABASE_URL = process.env.DATABASE_URL;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const RESEND_FROM = process.env.RESEND_FROM ?? 'notifications@kingsleyonoh.com';
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? process.env.KINGSLEY_EMAIL ?? 'kingsley@kingsleyonoh.com';

  if (!DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY is required');

  return { DATABASE_URL, RESEND_API_KEY, RESEND_FROM, ADMIN_EMAIL };
}

export async function setupClientPortalTenant(
  db: ReturnType<typeof createDb>['db'],
  env: SetupEnv,
) {
  // 1. Create tenant
  const apiKey = `cp-${crypto.randomUUID()}`;
  const [existing] = await db.select().from(tenants).where(eq(tenants.id, TENANT_ID)).limit(1);

  let tenant;
  if (existing) {
    [tenant] = await db
      .update(tenants)
      .set({
        name: TENANT_NAME,
        config: {
          channels: {
            email: { apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM },
          },
        },
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, TENANT_ID))
      .returning();
    console.log(`Updated tenant: ${TENANT_ID} (API key unchanged: ${existing.apiKey})`);
  } else {
    [tenant] = await db
      .insert(tenants)
      .values({
        id: TENANT_ID,
        name: TENANT_NAME,
        apiKey,
        config: {
          channels: {
            email: { apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM },
          },
        },
      })
      .returning();
    console.log(`Created tenant: ${TENANT_ID} (API key: ${tenant.apiKey})`);
  }

  // 2. Create templates
  const templateDefs = [
    {
      name: 'client-onboarded-email',
      channel: 'email' as const,
      subject: 'New Client Onboarded: {{clientName}}',
      body: '<h2>Client Onboarded</h2><p><strong>{{clientName}}</strong> has been onboarded successfully.</p><p>Client ID: {{clientId}}</p>',
    },
    {
      name: 'update-posted-email',
      channel: 'email' as const,
      subject: 'Project Update: {{projectName}}',
      body: '<h2>New Update on {{projectName}}</h2><p>Posted by: {{author}}</p><p>{{contentPreview}}</p>',
    },
    {
      name: 'comment-posted-email',
      channel: 'email' as const,
      subject: 'New Comment on Project Update',
      body: '<h2>New Comment</h2><p><strong>{{authorName}}</strong> ({{authorType}}) commented on an update.</p>',
    },
    {
      name: 'project-status-changed-email',
      channel: 'email' as const,
      subject: 'Project Status Changed: {{clientName}}',
      body: '<h2>Project Status Updated</h2><p>Client: <strong>{{clientName}}</strong></p><p>Status: {{oldStatus}} → <strong>{{newStatus}}</strong></p>',
    },
    {
      name: 'task-submitted-email',
      channel: 'email' as const,
      subject: 'New Task Request: {{title}}',
      body: '<h2>New Task Request</h2><p>Client: <strong>{{clientName}}</strong></p><p>Task: {{title}}</p>',
    },
    {
      name: 'task-status-changed-email',
      channel: 'email' as const,
      subject: 'Task Status Changed: {{title}}',
      body: '<h2>Task Status Updated</h2><p>Task: <strong>{{title}}</strong></p><p>Status: {{oldStatus}} → <strong>{{newStatus}}</strong></p>',
    },
    {
      name: '__digest',
      channel: 'email' as const,
      subject: 'Client Portal Digest — {{count}} notifications',
      body: '<h2>Your Notification Digest</h2>{{#each notifications}}<div style="margin-bottom:12px;padding:8px;border-left:3px solid #007bff"><strong>{{this.subject}}</strong><br>{{{this.body}}}</div>{{/each}}{{#if truncated}}<p><em>...and {{remaining_count}} more</em></p>{{/if}}',
    },
  ];

  let templatesCreated = 0;
  const templateMap: Record<string, string> = {};

  for (const def of templateDefs) {
    const [existing] = await db
      .select()
      .from(templates)
      .where(and(eq(templates.tenantId, TENANT_ID), eq(templates.name, def.name)))
      .limit(1);

    if (existing) {
      await db
        .update(templates)
        .set({ subject: def.subject, body: def.body, updatedAt: new Date() })
        .where(eq(templates.id, existing.id));
      templateMap[def.name] = existing.id;
    } else {
      const [created] = await db
        .insert(templates)
        .values({ tenantId: TENANT_ID, ...def })
        .returning();
      templateMap[def.name] = created.id;
      templatesCreated++;
    }
  }
  console.log(`Templates: ${templatesCreated} created, ${templateDefs.length - templatesCreated} updated`);

  // 3. Create rules
  const ruleDefs = [
    { eventType: 'client.onboarded', channel: 'email' as const, templateName: 'client-onboarded-email', recipientType: 'static' as const, recipientValue: env.ADMIN_EMAIL },
    { eventType: 'update.posted', channel: 'email' as const, templateName: 'update-posted-email', recipientType: 'static' as const, recipientValue: env.ADMIN_EMAIL },
    { eventType: 'comment.posted', channel: 'email' as const, templateName: 'comment-posted-email', recipientType: 'static' as const, recipientValue: env.ADMIN_EMAIL },
    { eventType: 'project.status_changed', channel: 'email' as const, templateName: 'project-status-changed-email', recipientType: 'static' as const, recipientValue: env.ADMIN_EMAIL },
    { eventType: 'task.submitted', channel: 'email' as const, templateName: 'task-submitted-email', recipientType: 'static' as const, recipientValue: env.ADMIN_EMAIL },
    { eventType: 'task.status_changed', channel: 'email' as const, templateName: 'task-status-changed-email', recipientType: 'static' as const, recipientValue: env.ADMIN_EMAIL },
  ];

  let rulesCreated = 0;
  for (const def of ruleDefs) {
    const templateId = templateMap[def.templateName];
    const [existing] = await db
      .select()
      .from(notificationRules)
      .where(
        and(
          eq(notificationRules.tenantId, TENANT_ID),
          eq(notificationRules.eventType, def.eventType),
          eq(notificationRules.channel, def.channel),
          eq(notificationRules.recipientType, def.recipientType),
          eq(notificationRules.recipientValue, def.recipientValue),
        ),
      )
      .limit(1);

    if (!existing) {
      await db.insert(notificationRules).values({
        tenantId: TENANT_ID,
        eventType: def.eventType,
        channel: def.channel,
        templateId,
        recipientType: def.recipientType,
        recipientValue: def.recipientValue,
      });
      rulesCreated++;
    }
  }
  console.log(`Rules: ${rulesCreated} created, ${ruleDefs.length - rulesCreated} already exist`);

  // 4. Create admin preferences
  const [existingPrefs] = await db
    .select()
    .from(userPreferences)
    .where(and(eq(userPreferences.tenantId, TENANT_ID), eq(userPreferences.userId, 'admin')))
    .limit(1);

  if (!existingPrefs) {
    await db.insert(userPreferences).values({
      tenantId: TENANT_ID,
      userId: 'admin',
      email: env.ADMIN_EMAIL,
    });
    console.log('Admin preferences created');
  }

  console.log('\n=== Client Portal Tenant Ready ===');
  console.log(`Tenant ID: ${TENANT_ID}`);
  console.log(`API Key: ${tenant.apiKey}`);
  console.log(`Admin Email: ${env.ADMIN_EMAIL}`);
  console.log(`\nSet these in Client Portal .env.local:`);
  console.log(`  NOTIFICATION_HUB_ENABLED=true`);
  console.log(`  NOTIFICATION_HUB_URL=http://localhost:3000`);
  console.log(`  NOTIFICATION_HUB_API_KEY=${tenant.apiKey}`);

  return { tenantId: TENANT_ID, apiKey: tenant.apiKey };
}

// CLI entry point
const isDirectRun = process.argv[1]?.includes('setup-client-portal');
if (isDirectRun) {
  const env = loadEnv();
  const { db, sql } = createDb(env.DATABASE_URL);
  setupClientPortalTenant(db, env)
    .then(() => sql.end())
    .catch((err) => {
      console.error('Setup failed:', err);
      sql.end();
      process.exit(1);
    });
}
