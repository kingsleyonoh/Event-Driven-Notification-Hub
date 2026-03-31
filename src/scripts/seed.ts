import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });

import crypto from 'node:crypto';
import { tenants, templates, notificationRules } from '../db/schema.js';
import { createDb, type Database } from '../db/client.js';
import { loadConfig } from '../config.js';

function generateApiKey(): string {
  return `nhk_${crypto.randomBytes(24).toString('hex')}`;
}

export async function seed(db: Database): Promise<void> {
  // ─── Tenants ─────────────────────────────────────────────────────

  await db.insert(tenants).values([
    { id: 'default', name: 'Default Tenant', apiKey: generateApiKey() },
    { id: 'demo', name: 'Demo Tenant', apiKey: generateApiKey() },
  ]);

  // ─── Digest templates (one per tenant) ───────────────────────────

  const digestBody = `<h2>Notification Digest</h2>
<p>You have {{count}} notifications:</p>
<ul>
{{#each notifications}}
  <li><strong>{{this.subject}}</strong> — {{this.body}}</li>
{{/each}}
</ul>
{{#if truncated}}
<p>...and {{remaining_count}} more.</p>
{{/if}}`;

  await db.insert(templates).values([
    {
      tenantId: 'default',
      name: '__digest',
      channel: 'email',
      subject: 'Your notification digest',
      body: digestBody,
    },
    {
      tenantId: 'demo',
      name: '__digest',
      channel: 'email',
      subject: 'Your notification digest',
      body: digestBody,
    },
  ]);

  // ─── Demo templates ──────────────────────────────────────────────

  const demoTemplates = await db
    .insert(templates)
    .values([
      {
        tenantId: 'demo',
        name: 'task-assigned-email',
        channel: 'email',
        subject: 'Task assigned: {{task.title}}',
        body: 'Hi {{assignee.name}}, you have been assigned "{{task.title}}" by {{assigner.name}}.',
      },
      {
        tenantId: 'demo',
        name: 'comment-added-email',
        channel: 'email',
        subject: 'New comment on {{item.title}}',
        body: '{{author.name}} commented: "{{comment.text}}"',
      },
      {
        tenantId: 'demo',
        name: 'build-completed-email',
        channel: 'email',
        subject: 'Build {{build.status}}: {{build.name}}',
        body: 'Build #{{build.number}} finished with status {{build.status}}.',
      },
      {
        tenantId: 'demo',
        name: 'deploy-started-email',
        channel: 'email',
        subject: 'Deploy started: {{deploy.environment}}',
        body: '{{deploy.user}} started a deploy to {{deploy.environment}} for {{deploy.service}}.',
      },
    ])
    .returning({ id: templates.id });

  // ─── Demo rules ──────────────────────────────────────────────────

  await db.insert(notificationRules).values([
    {
      tenantId: 'demo',
      eventType: 'task.assigned',
      channel: 'email',
      templateId: demoTemplates[0].id,
      recipientType: 'event_field',
      recipientValue: 'assignee.id',
    },
    {
      tenantId: 'demo',
      eventType: 'comment.added',
      channel: 'email',
      templateId: demoTemplates[1].id,
      recipientType: 'event_field',
      recipientValue: 'item.owner_id',
    },
    {
      tenantId: 'demo',
      eventType: 'build.completed',
      channel: 'email',
      templateId: demoTemplates[2].id,
      recipientType: 'event_field',
      recipientValue: 'build.triggered_by',
    },
    {
      tenantId: 'demo',
      eventType: 'deploy.started',
      channel: 'email',
      templateId: demoTemplates[3].id,
      recipientType: 'static',
      recipientValue: 'ops-team@example.com',
    },
  ]);
}

// Run directly when executed as a script
const isDirectRun = process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js');
if (isDirectRun) {
  const config = loadConfig();
  const { db, sql } = createDb(config.DATABASE_URL);
  seed(db)
    .then(() => {
      console.log('Seed complete.');
      return sql.end();
    })
    .catch((err) => {
      console.error('Seed failed:', err.message);
      process.exit(1);
    });
}
