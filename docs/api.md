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
| GET/POST/PATCH/DELETE | `/api/v1/webhooks`                 | Manage webhook endpoints         |
| GET                   | `/api/v1/webhooks/{id}/deliveries` | Delivery log                     |

All responses use `{ data: ... }` or `{ error: { code, message } }`.

## Unsubscribe

One-click unsubscribe links resolve to `GET /api/v1/unsubscribe?token=...` (HTML confirmation, no API key required).
