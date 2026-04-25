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

## 10. Resend Webhook Configuration (Email Delivery Tracking)

The Hub records every Resend delivery event (delivered / bounced / complained / delayed) in `email_delivery_events` and updates the originating `notifications` row with status, `delivered_at`, and `bounce_type`. To enable this, configure Resend to POST webhooks to your Hub instance, and (optionally) configure your tenant to receive HMAC-signed callbacks for those events.

### 10.1 Configure the Resend webhook (one-time, Hub-wide)

In your [Resend dashboard](https://resend.com/webhooks):

1. **Endpoint URL:** `https://<your-hub-domain>/api/webhooks/resend`
2. **Events to subscribe:**
   - `email.delivered`
   - `email.bounced`
   - `email.complained`
   - `email.delivery_delayed`
3. **Signing secret:** Resend generates a `whsec_...` secret. Copy it and set it in your Hub's environment:

   ```env
   RESEND_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

The Hub verifies every inbound webhook against this secret using the Svix scheme — invalid signatures return `401`.

### 10.2 Configure per-tenant delivery callbacks (optional)

If your tenant wants the Hub to forward delivery events to its own backend (so it can update its own DB, dashboards, etc.), set a `deliveryCallbackUrl` on the tenant's email channel config and provide the tenant with the one-time `delivery_callback_secret` minted at tenant-create time.

**Tenant config:**

```bash
curl -X PATCH https://<your-hub-domain>/api/admin/tenants/<tenant-id> \
  -H "X-Admin-Key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "channels": {
        "email": {
          "apiKey": "re_...",
          "from": "you@yourdomain.com",
          "deliveryCallbackUrl": "https://your-tenant-app.example.com/hub-callback"
        }
      }
    }
  }'
```

**Tenant-side secret:** When you originally created the tenant via `POST /api/admin/tenants`, the response included a one-time `deliveryCallbackSecret` field. The tenant should store this in their own environment (e.g., `HUB_CALLBACK_SECRET`). It is NOT returned by `GET /api/admin/tenants/:id` — if lost, rotate via the admin API.

### 10.3 Tenant-side signature verification

The Hub POSTs each delivery event to `deliveryCallbackUrl` with header:

```
X-Hub-Signature: sha256=<lowercase-hex-hmac-sha256>
Content-Type: application/json
```

The signature is computed over the **canonical-JSON-stringified body** (stable key ordering). Tenants MUST verify against the **raw bytes** received from the wire — not against a re-stringified parsed body — because any whitespace difference would break the HMAC.

**Node.js example:**

```js
const crypto = require('crypto');

function verifyHubCallback(rawBody, signatureHeader, secret) {
  if (!signatureHeader) return false;
  const expected =
    'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  // Constant-time compare; lengths must match.
  if (signatureHeader.length !== expected.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(signatureHeader),
    Buffer.from(expected),
  );
}

// In an Express handler — read the RAW body before any JSON middleware parses it:
//   app.post('/hub-callback', express.raw({ type: 'application/json' }), (req, res) => {
//     const valid = verifyHubCallback(req.body, req.header('x-hub-signature'), process.env.HUB_CALLBACK_SECRET);
//     if (!valid) return res.status(401).end();
//     const event = JSON.parse(req.body.toString('utf-8'));
//     // ... handle event
//     res.status(200).end();
//   });
```

**Python example:**

```python
import hmac
import hashlib

def verify_hub_callback(raw_body: bytes, signature_header: str, secret: str) -> bool:
    if not signature_header:
        return False
    expected = 'sha256=' + hmac.new(
        secret.encode('utf-8'),
        raw_body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(signature_header, expected)

# In a Flask handler:
#   @app.post('/hub-callback')
#   def hub_callback():
#       raw = request.get_data()  # raw bytes, NOT request.json
#       if not verify_hub_callback(raw, request.headers.get('X-Hub-Signature'), os.environ['HUB_CALLBACK_SECRET']):
#           return '', 401
#       event = json.loads(raw)
#       # ... handle event
#       return '', 200
```

### 10.4 Important notes

- The Hub **canonicalizes** JSON (sorts object keys recursively at every depth) before signing. Tenants MUST verify against the raw bytes received — re-serialising the parsed body before HMAC will produce a different digest and the verification will fail.
- The Hub's webhook handler always returns **200** to Resend, even if your tenant callback returns 5xx. Resend retries are reserved for genuine transport failures (auth, malformed payloads). Per-tenant callback failures are logged into `email_delivery_events.callback_status_code` so you can poll for failed deliveries.
- The callback request has a **5-second timeout**. Tenants whose endpoints are slow will see `callback_status_code = NULL` on aborted requests.
- Callback dispatch is **opt-in** — tenants without a `deliveryCallbackUrl` simply have the events recorded in `email_delivery_events` and the originating `notifications` row updated; no outbound POST happens.

## Troubleshooting

- **No Telegram message:** Verify you completed the `/start` flow with the bot. Check preferences: `GET /api/preferences/kingsley`
- **No email:** Verify your Resend API key is valid and the sender domain is verified in Resend.
- **Script errors:** Ensure all `KINGSLEY_*` env vars are set in `.env.local` and `DATABASE_URL` points to a running PostgreSQL instance.
- **Re-run setup:** The script is idempotent. Run `npm run setup:personal` again to update config without duplicating data.
- **Resend webhook 401s:** `RESEND_WEBHOOK_SECRET` is missing, has the wrong `whsec_...` value, or the timestamp drifted >5min from server time.
- **Tenant callback signature mismatch:** Verify against raw request bytes, not the parsed body. JSON middleware that runs before your verification handler will silently reformat the bytes and break HMAC.
