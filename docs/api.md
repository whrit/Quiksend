# Quiksend Public API

The public REST API is versioned under `/api/v1/*` and authenticated with workspace-scoped API keys.

## Authentication

Create an API key in **Settings → API keys**, then pass it as a Bearer token:

```bash
curl -s -H "Authorization: Bearer qsk_..." \
  http://localhost:3000/api/v1/prospects
```

Keys are scoped to the active workspace stored in key metadata. A key from workspace A returns **404** (not 403) for resources in workspace B — this avoids leaking existence across tenants.

## Rate limits

- **100 requests/minute** per API key (tracked in `api_key_usage`)
- Over-limit responses return **429** with a `Retry-After` header

## OpenAPI

Machine-readable spec: [GET /api/v1/openapi.json](http://localhost:3000/api/v1/openapi.json)

## Endpoints

| Method                | Path                               | Description                      |
| --------------------- | ---------------------------------- | -------------------------------- |
| GET                   | `/api/v1/prospects`                | List prospects                   |
| POST                  | `/api/v1/prospects`                | Create/upsert prospect           |
| GET                   | `/api/v1/prospects/{id}`           | Get prospect                     |
| PATCH                 | `/api/v1/prospects/{id}`           | Update prospect                  |
| DELETE                | `/api/v1/prospects/{id}`           | Soft-delete prospect             |
| POST                  | `/api/v1/enrollments`              | Enroll prospects into a sequence |
| GET                   | `/api/v1/sequences/{id}/analytics` | Funnel + step rates              |
| GET                   | `/api/v1/messages`                 | List messages                    |
| GET, POST             | `/api/v1/webhooks`                 | List / create webhook endpoints  |
| PATCH, DELETE         | `/api/v1/webhooks/{id}`            | Update / delete webhook endpoint |
| GET                   | `/api/v1/webhooks/{id}/deliveries` | Delivery log                     |

> **Compat note.** For older integrations, `PATCH /api/v1/webhooks` also accepts `id` in the JSON body, and `DELETE /api/v1/webhooks` accepts `?id=…`. Prefer the path form for new code.

All responses use `{ data: ... }` or `{ error: { code, message } }`.

## Unsubscribe

One-click unsubscribe links resolve to `GET /api/v1/unsubscribe?token=...` (HTML confirmation, no API key required).

## Deliverability data

Phase 11 (enterprise deliverability) does not expose new public REST endpoints. Gateway classifications, seed inbox management, and the deliverability grid are UI + server-fn only. Deliverability signals reach external systems via **webhooks** — subscribe to `enrollment.no_safe_mailbox_for_gateway`, `deliverability.canary.arrived`, `deliverability.canary.silent_drop`, and `gateway.detected` at **Settings → Webhooks** or the `/api/v1/webhooks` endpoint. See [webhooks.md](./webhooks.md) and [deliverability.md](./deliverability.md).
