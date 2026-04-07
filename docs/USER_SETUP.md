# Personal Setup Guide

Set up the Notification Hub as a personal notification router with email and Telegram channels.

## Prerequisites

- Docker and Docker Compose installed
- Node.js 22+ and npm
- A [Resend](https://resend.com) API key
- A [Telegram Bot](https://core.telegram.org/bots#how-do-i-create-a-bot) token (via @BotFather)

## 1. Clone and Install

```bash
git clone <repo-url> && cd event-driven-notification-hub
npm install
```

## 2. Start Infrastructure

```bash
docker compose up -d
```

This starts PostgreSQL and Redpanda (Kafka-compatible broker).

## 3. Run Migrations

```bash
npx drizzle-kit migrate
```

## 4. Configure Environment

Copy `.env.example` to `.env.local` and fill in the values:

```bash
cp .env.example .env.local
```

Add your personal tenant config at the bottom of `.env.local`:

```env
KINGSLEY_RESEND_KEY=re_your_key_here
KINGSLEY_RESEND_FROM=notifications@yourdomain.com
KINGSLEY_TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
KINGSLEY_TELEGRAM_BOT_USERNAME=YourBotUsername
KINGSLEY_EMAIL=you@example.com
```

## 5. Run the Personal Setup Script

```bash
npm run setup:personal
```

This creates:
- A tenant with your email and Telegram credentials
- Default notification rules for `task.assigned`, `deploy.completed`, and `alert.triggered`
- Templates for each event type and channel
- User preferences with your email

Save the API key from the output -- you will need it for all API requests.

## 6. Start the Server

```bash
npm run dev
```

## 7. Connect Telegram

Generate a Telegram link token:

```bash
curl -X POST http://localhost:3000/api/preferences/kingsley/telegram/link \
  -H "X-API-Key: YOUR_API_KEY"
```

The response contains a `link_url`. Open it in your browser or Telegram -- it will redirect you to your bot. Click **Start** (or send `/start`) to link your Telegram account.

## 8. Test with a Sample Event

Send a test event to verify everything works:

```bash
curl -X POST http://localhost:3000/api/events \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "alert.triggered",
    "event_id": "test-001",
    "payload": {
      "recipient": { "id": "kingsley" },
      "alert": {
        "name": "CPU Spike",
        "message": "Server CPU at 95%",
        "severity": "high",
        "source": "monitoring",
        "timestamp": "2026-04-07T12:00:00Z"
      }
    }
  }'
```

You should receive:
- An email at the address you configured
- A Telegram message from your bot

## 9. Check Notification Status

```bash
curl http://localhost:3000/api/notifications?userId=kingsley \
  -H "X-API-Key: YOUR_API_KEY"
```

## Troubleshooting

- **No Telegram message:** Verify you completed the `/start` flow with the bot. Check preferences: `GET /api/preferences/kingsley`
- **No email:** Verify your Resend API key is valid and the sender domain is verified in Resend.
- **Script errors:** Ensure all `KINGSLEY_*` env vars are set in `.env.local` and `DATABASE_URL` points to a running PostgreSQL instance.
- **Re-run setup:** The script is idempotent. Run `npm run setup:personal` again to update config without duplicating data.
