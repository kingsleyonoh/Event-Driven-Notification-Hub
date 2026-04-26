# Production Smoke Test — Notification Hub

> Runbook for verifying the full Phase 7 H4 chain end-to-end in production:
> **client → /api/events → Resend → email delivered → Resend webhook → email_delivery_events row.**
>
> This is the test the Phase 7 ship-gate spec required. Re-run it after any
> non-trivial change to the email path, the webhook route, or the dispatcher.
>
> **First successful run:** 2026-04-26. See [build-journal/021-batch.md](./build-journal/021-batch.md) for context.

## What it proves

Each link in the chain must work for the test to pass — pass = every link
proven; fail = pinpoints which link broke:

| Link | Proof |
|------|-------|
| Hub accepts events | `POST /api/events` returns `{published:true, processed:1}` |
| Pipeline renders + dispatches | `notifications.status='sent'`, `delivered_at` populated |
| Resend SDK call works | A real email arrives in the recipient's inbox |
| Hub correctly attaches `X-Hub-*` correlation headers | `email_delivery_events.tenant_id` populated correctly |
| Resend → Hub webhook | New row in `email_delivery_events` within ~5s of send |
| Svix signature verification | Resend's signed payload accepted (no 401 in webhook logs) |
| 7b `_metadata` pass-through | `notifications.metadata` populated from `payload._metadata` |

## Prerequisites

| Need | Where it lives |
|------|----------------|
| SSH access to VPS | `ssh deploy@104.248.137.96` (passwordless) |
| Admin API key | VPS: `/apps/notification-hub/.env` → `ADMIN_API_KEY` |
| Resend API key | VPS: `/apps/notification-hub/.env` → `RESEND_API_KEY` |
| `RESEND_WEBHOOK_SECRET` | VPS: `/apps/notification-hub/.env` (must be set — Resend → Hub fails without it) |
| Resend webhook configured | Resend dashboard → Webhooks → `https://notify.kingsleyonoh.com/api/webhooks/resend` subscribed to `email.delivered`, `email.bounced`, `email.complained`, `email.delivery_delayed` |
| Recipient email you control | Default: `harrisononh3@gmail.com` |

## Existing test artifacts on prod (reuse if still present)

These were created during the 2026-04-26 smoke test and intentionally left
in place. If they're still there, you can reuse them; if cleaned up later,
just create a fresh tenant.

| Resource | ID/Name |
|----------|---------|
| Test tenant | `phase-7-smoke-test-a0a17f72` (name: "Phase 7 Smoke Test") |
| Test template | `smoke-welcome-final` |
| Test rule | event_type `smoke.test.final` → email → `harrisononh3@gmail.com` |

To check if they're still there:
```bash
ssh deploy@104.248.137.96 "docker exec shared-postgres psql -U postgres -d notification_hub -c \"SELECT id, name FROM tenants WHERE id LIKE 'phase-7-smoke%';\""
```

## Run the smoke test

### Step 0 — Pull credentials from prod (read-only)

```bash
ssh deploy@104.248.137.96 "grep -E '^(ADMIN_API_KEY|RESEND_API_KEY)=' /apps/notification-hub/.env" > /tmp/prod-keys.env
ADMIN_KEY=$(grep "^ADMIN_API_KEY=" /tmp/prod-keys.env | cut -d'=' -f2 | tr -d '"' | tr -d "'")
RESEND_KEY=$(grep "^RESEND_API_KEY=" /tmp/prod-keys.env | cut -d'=' -f2 | tr -d '"' | tr -d "'")
HUB="https://notify.kingsleyonoh.com"
RECIPIENT="harrisononh3@gmail.com"
```

### Step 1 — Create test tenant (skip if reusing)

```bash
RESP=$(curl -s -X POST $HUB/api/admin/tenants \
  -H "X-Admin-Key: $ADMIN_KEY" -H "Content-Type: application/json" \
  -d "{
    \"id\": \"smoke-$(date +%s)\",
    \"name\": \"Phase 7 Smoke Test\",
    \"config\": {
      \"channels\": {
        \"email\": {
          \"apiKey\": \"$RESEND_KEY\",
          \"from\": \"Hub Smoke <smoke@notify.klevar.ai>\"
        }
      }
    }
  }")
TID=$(echo "$RESP" | python -c "import json,sys; print(json.load(sys.stdin)['tenant']['id'])")
TKEY=$(echo "$RESP" | python -c "import json,sys; print(json.load(sys.stdin)['tenant']['apiKey'])")
echo "Tenant: $TID  /  Key: ${TKEY:0:8}…"
```

If reusing an existing tenant, query its api_key from the admin endpoint
(it's masked in normal responses; you'd need the saved value from creation
time, OR rotate it via PUT).

### Step 2 — Create template

```bash
TPL=$(curl -s -X POST $HUB/api/templates \
  -H "X-API-Key: $TKEY" -H "Content-Type: application/json" \
  -d '{
    "name":"smoke-welcome-final",
    "channel":"email",
    "subject":"Phase 7 smoke test",
    "body":"<h2>Phase 7 smoke test</h2><p>Hi {{name}}, real email through prod at {{timestamp}}.</p><p><small>event_id: {{trace_id}}</small></p>"
  }')
TPL_ID=$(echo "$TPL" | python -c "import json,sys; print(json.load(sys.stdin)['template']['id'])")
echo "Template: $TPL_ID"
```

### Step 3 — Create rule

```bash
RULE=$(curl -s -X POST $HUB/api/rules \
  -H "X-API-Key: $TKEY" -H "Content-Type: application/json" \
  -d "{
    \"event_type\": \"smoke.test.final\",
    \"channel\": \"email\",
    \"template_id\": \"$TPL_ID\",
    \"recipient_type\": \"static\",
    \"recipient_value\": \"$RECIPIENT\"
  }")
echo "Rule: $(echo "$RULE" | python -c "import json,sys; print(json.load(sys.stdin)['rule']['id'])")"
```

### Step 4 — Send the event (real email goes out)

```bash
EVT_ID="smoke-final-$(date +%s)"
curl -s -X POST $HUB/api/events \
  -H "X-API-Key: $TKEY" -H "Content-Type: application/json" \
  -d "{
    \"event_type\": \"smoke.test.final\",
    \"event_id\": \"$EVT_ID\",
    \"payload\": {
      \"name\": \"Kingsley\",
      \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
      \"trace_id\": \"$EVT_ID\",
      \"_metadata\": { \"smoke_test\": true, \"trace_id\": \"$EVT_ID\" }
    }
  }"
echo "$EVT_ID" > /tmp/smoke-evtid
```

Expected: `{"published":true,"processed":1}`

### Step 5 — Verify notification dispatched

```bash
sleep 5
curl -s "$HUB/api/notifications?limit=5" -H "X-API-Key: $TKEY" \
  | python -c "
import json,sys
data = json.load(sys.stdin)
for n in data['notifications']:
    if n['eventId'] == '$EVT_ID':
        print('  status        :', n['status'])
        print('  delivered_at  :', n['deliveredAt'])
        print('  metadata      :', n['metadata'])
        break
"
```

Expected:
- `status: sent`
- `delivered_at` is an ISO timestamp
- `metadata: {'trace_id': 'smoke-final-...', 'smoke_test': True}`

### Step 6 — Wait for Resend webhook → email_delivery_events row

```bash
until [ "$(ssh deploy@104.248.137.96 "docker exec shared-postgres psql -U postgres -d notification_hub -t -c \"SELECT count(*) FROM email_delivery_events WHERE created_at > NOW() - INTERVAL '5 minutes';\"" 2>/dev/null | tr -d ' ')" -gt 0 ]; do
  sleep 3
done
ssh deploy@104.248.137.96 "docker exec shared-postgres psql -U postgres -d notification_hub -c \"SELECT event_type, resend_email_id, callback_status_code, created_at FROM email_delivery_events WHERE created_at > NOW() - INTERVAL '5 minutes' ORDER BY created_at DESC;\""
```

Expected within ~10s of step 4:
- At least 1 row with `event_type=email.sent` or `email.delivered`
- `tenant_id` matches your test tenant
- `callback_status_code` is `null` (no `deliveryCallbackUrl` configured on this tenant — that's fine; it tests Resend→Hub but skips Hub→tenant)

### Step 7 — Confirm the email arrived

Check inbox at `$RECIPIENT`. Subject: "Phase 7 smoke test". If it landed in
spam, that's a separate Resend domain / DKIM concern, not a Hub problem.

## Pass/fail interpretation

| Symptom | What's broken |
|---------|---------------|
| Step 4 returns `published:false` | Hub itself down — check `/api/health` |
| Step 4 returns 429 | Per-tenant rate limit hit (H7) — wait 1 minute or PATCH the limit higher |
| Step 5 `status: failed` with `error_message: "Unable to fetch data..."` | Resend SDK error — invalid `RESEND_API_KEY` or domain not verified |
| Step 5 OK, but Step 6 never fires (timeout) | Resend webhook not configured in dashboard, OR `RESEND_WEBHOOK_SECRET` mismatch — check Hub logs for `signature verification failed` |
| Step 6 fires but `tenant_id` is wrong | `X-Hub-*` correlation headers not being attached at email send time — regression in `email.ts` |
| Step 7: no email in inbox or spam | Resend delivery issue (recipient mailbox, DKIM, etc.) — check the Resend dashboard delivery log |

## Cleanup (optional)

```bash
ssh deploy@104.248.137.96 "docker exec shared-postgres psql -U postgres -d notification_hub -c \"DELETE FROM tenants WHERE id LIKE 'smoke-%' OR id LIKE 'phase-7-smoke%' OR id LIKE 'check-test-%';\""
```

CASCADE FKs will clean up dependent templates/rules/notifications/email_delivery_events automatically.

## Production gotchas this test has caught

- **2026-04-26 — Phase 7.6 hotfix:** `webhookRoutes` was wrapped in `fastify-plugin` (`fp()`), which BREAKS encapsulation. The `addContentTypeParser('application/json', { parseAs: 'string' })` for raw-body signature verification leaked to the parent app, breaking every other JSON POST endpoint with `FST_ERR_CTP_INVALID_CONTENT_LENGTH`. Caught in Step 2 (template create returned 500). Fix: drop the `fp()` wrapper. Regression test added to `webhooks.routes.test.ts` registering webhookRoutes alongside a sibling JSON-POST route.
