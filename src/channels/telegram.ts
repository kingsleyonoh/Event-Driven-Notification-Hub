import { createLogger } from '../lib/logger.js';
import type { DispatchResult } from './dispatcher.js';

const logger = createLogger('telegram');

export interface TelegramConfig {
  botToken: string;
  botUsername: string;
}

export async function sendTelegram(
  chatId: string,
  subject: string | null,
  body: string,
  config: TelegramConfig,
): Promise<DispatchResult> {
  const text = subject ? `*${subject}*\n\n${body}` : body;

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${config.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'Markdown',
        }),
      },
    );

    const data = await response.json();

    if (!response.ok || !data.ok) {
      const errorMsg = data.description ?? `HTTP ${response.status}`;
      logger.error({ chatId, error: errorMsg }, 'telegram send failed');
      return { success: false, error: errorMsg };
    }

    logger.info({ chatId, messageId: data.result?.message_id }, 'telegram sent');
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown telegram error';
    logger.error({ chatId, error: message }, 'telegram send threw');
    return { success: false, error: message };
  }
}
