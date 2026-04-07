import { eq, and } from 'drizzle-orm';
import { tenants, userPreferences } from '../db/schema.js';
import { resolveTenantChannelConfig } from '../lib/channel-config.js';
import { createLogger } from '../lib/logger.js';
import type { Database } from '../db/client.js';

const logger = createLogger('telegram-bot');

interface BotState {
  tenantId: string;
  botToken: string;
  offset: number;
}

export async function pollTelegramUpdates(
  db: Database,
  botStates: Map<string, BotState>,
): Promise<void> {
  const allTenants = await db
    .select()
    .from(tenants)
    .where(eq(tenants.enabled, true));

  for (const tenant of allTenants) {
    const telegramConfig = resolveTenantChannelConfig(tenant.config, 'telegram');
    if (!telegramConfig) continue;

    const botToken = telegramConfig.botToken as string;
    const key = tenant.id;

    if (!botStates.has(key)) {
      botStates.set(key, { tenantId: tenant.id, botToken, offset: 0 });
    }

    const state = botStates.get(key)!;

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/getUpdates?offset=${state.offset}&timeout=0`,
      );
      const data = await response.json();

      if (!data.ok || !Array.isArray(data.result)) continue;

      for (const update of data.result) {
        state.offset = update.update_id + 1;

        const text = update.message?.text ?? '';
        const chatId = String(update.message?.chat?.id ?? '');

        if (!text.startsWith('/start ') || !chatId) continue;

        const token = text.slice(7).trim();

        const [prefs] = await db
          .select()
          .from(userPreferences)
          .where(
            and(
              eq(userPreferences.tenantId, tenant.id),
              eq(userPreferences.telegramLinkToken, token),
            ),
          )
          .limit(1);

        if (prefs) {
          await db
            .update(userPreferences)
            .set({
              telegramChatId: chatId,
              telegramLinkToken: null,
              updatedAt: new Date(),
            })
            .where(eq(userPreferences.id, prefs.id));
          logger.info(
            { tenantId: tenant.id, userId: prefs.userId, chatId },
            'telegram linked',
          );
        } else {
          logger.warn(
            { tenantId: tenant.id, token },
            'unknown telegram link token',
          );
        }
      }
    } catch (err) {
      logger.error(
        { tenantId: tenant.id, error: err },
        'telegram poll failed',
      );
    }
  }
}

export function createTelegramBotWorker(db: Database) {
  const botStates = new Map<string, BotState>();

  return {
    poll: () => pollTelegramUpdates(db, botStates),
  };
}
