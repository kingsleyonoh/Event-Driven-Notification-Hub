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

## 11. Phase 7 Features Reference

The Hub ships ten advanced email/multi-tenant features layered on top of the basic flow above. Each is opt-in via tenant or template config — defaults preserve legacy behavior. Features below are listed in the order they appear in the dispatch pipeline.

### 11.1 Email attachments (`attachments_config` on templates)

Templates can declare a list of attachment slots; the pipeline fetches each URL from the event payload at dispatch time, base64-encodes it, and forwards to Resend. Filename and URL field are both Handlebars-templated.

```bash
curl -X POST .../api/templates -H "X-API-Key: $KEY" -d '{
  "name": "invoice", "channel": "email", "body": "...",
  "attachments_config": [
    { "filename_template": "invoice-{{invoice_number}}.pdf", "url_field": "invoice_url" }
  ]
}'
```

Failed fetches mark the notification `failed` with a clear `attachment fetch failed: ...` error — no email is sent.

### 11.2 reply_to (event > template > tenant priority)

Three layers, highest wins: `event.payload._reply_to` (per-message), `templates.reply_to` (per-template default), `tenants.config.channels.email.replyTo` (tenant fallback). Useful when one tenant runs multiple support inboxes through one Resend domain.

```json
{ "event_type": "ticket.replied", "event_id": "...", "payload": {
  "_reply_to": "billing@yourdomain.com", ...
}}
```

### 11.3 Custom email headers (RFC 8058 List-Unsubscribe)

Templates can declare custom headers (Handlebars-templated values). RFC-822 token names only; reserved names (`Content-Type`, `From`, `To`, `Subject`) are rejected at validate-time. Per-header render failures are soft: the rest still ship.

```json
{ "headers": {
  "List-Unsubscribe": "<{{unsub_url}}>",
  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
}}
```

### 11.4 Resend webhook + per-tenant delivery callback

See section 10 above for full details. The Hub records every Resend delivery event (`delivered`/`bounced`/`complained`/`delivery_delayed`) in `email_delivery_events`, updates the originating notification's `status` / `delivered_at` / `bounce_type`, and (if configured) POSTs an HMAC-signed callback to the tenant's `deliveryCallbackUrl`.

### 11.5 Sandbox mode (per-tenant `sandbox: true` toggle)

Set `tenants.config.channels.email.sandbox = true` to short-circuit Resend sends. Notifications still traverse all pipeline gates (preferences, quiet hours, dedup, suppression) and land as `sent_sandbox` so you can audit what would have shipped.

```json
{ "config": { "channels": { "email": {
  "apiKey": "re_...", "from": "noreply@x.com", "sandbox": true
}}}}
```

### 11.6 Multi-domain Resend support (`fromDomains` array)

Tenants with multiple verified Resend domains can list them; rules pick a domain via `from_domain_override` (per-rule). Priority: rule override → tenant `default: true` entry → first entry → legacy `from`.

```json
{ "channels": { "email": {
  "apiKey": "re_...", "from": "noreply@primary.com",
  "fromDomains": [
    { "domain": "primary.com", "default": true },
    { "domain": "transactional.com", "default": false }
  ]
}}}
```

```bash
curl -X POST .../api/rules -H "X-API-Key: $KEY" -d '{
  "event_type": "tx.completed", "channel": "email",
  "template_id": "...", "recipient_type": "static",
  "recipient_value": "ops@x.com",
  "from_domain_override": "transactional.com"
}'
```

### 11.7 Per-tenant `/api/events` rate limit

Set `tenants.config.rate_limits.events_per_minute` (1–1000, default 60) to override the global rate limit on `POST /api/events` for that tenant. Patch via the dedicated admin endpoint:

```bash
curl -X PATCH .../api/admin/tenants/$ID/rate-limit \
  -H "X-Admin-Key: $ADMIN_API_KEY" \
  -d '{"events_per_minute": 250}'
```

### 11.8 Plain-text email body fallback (`body_text`)

Templates can declare a separate plain-text body for non-HTML clients. When set, it's rendered with the same payload and forwarded to Resend; when omitted, Resend auto-generates a text alternative from the HTML body.

```json
{ "body": "<p>Hi {{name}}!</p>", "body_text": "Hi {{name}}!" }
```

### 11.9 Multi-language template variants (locale + en fallback)

Templates are unique by `(tenant_id, name, locale)`. The pipeline reads `event.payload.locale` (default `'en'`) and looks up the matching variant; if missing, it falls back to the template's own locale, then the `'en'` variant for the same name. If no `'en'` exists either, the notification is marked `failed`.

```bash
# Create EN + DE variants
curl -X POST .../api/templates -d '{ "name": "welcome", "locale": "en", ... }'
curl -X POST .../api/templates -d '{ "name": "welcome", "locale": "de", ... }'
```

### 11.10 Per-tenant suppression list

Hard bounces and spam complaints from Resend auto-populate `tenant_suppressions`. Manual entries via admin API. Pre-dispatch guard skips notifications targeting suppressed recipients (status `skipped`, `skip_reason: suppressed`).

```bash
# Manually suppress
curl -X POST .../api/suppressions \
  -H "X-API-Key: $KEY" \
  -d '{"recipient": "bounced@x.com", "reason": "manual"}'

# List
curl .../api/suppressions -H "X-API-Key: $KEY"

# Remove
curl -X DELETE .../api/suppressions/$ID -H "X-API-Key: $KEY"
```

## Troubleshooting

- **No Telegram message:** Verify you completed the `/start` flow with the bot. Check preferences: `GET /api/preferences/kingsley`
- **No email:** Verify your Resend API key is valid and the sender domain is verified in Resend.
- **Script errors:** Ensure all `KINGSLEY_*` env vars are set in `.env.local` and `DATABASE_URL` points to a running PostgreSQL instance.
- **Re-run setup:** The script is idempotent. Run `npm run setup:personal` again to update config without duplicating data.
- **Resend webhook 401s:** `RESEND_WEBHOOK_SECRET` is missing, has the wrong `whsec_...` value, or the timestamp drifted >5min from server time.
- **Tenant callback signature mismatch:** Verify against raw request bytes, not the parsed body. JSON middleware that runs before your verification handler will silently reformat the bytes and break HMAC.
