# Outbound Webhooks

Quiksend delivers HMAC-signed JSON payloads to HTTPS endpoints you register via the API or **Settings → Webhooks**.

## Event types

- `message.sent`
- `enrollment.completed` / `enrollment.replied` / `enrollment.bounced`
- `enrollment.paused` / `enrollment.resumed` / `enrollment.stopped` / `enrollment.failed`
- `prospect.unsubscribed`

## Delivery headers

| Header                   | Description                     |
| ------------------------ | ------------------------------- |
| `Content-Type`           | `application/json`              |
| `X-Quiksend-Signature`   | HMAC-SHA256 hex digest          |
| `X-Quiksend-Delivery-Id` | Delivery UUID (idempotency key) |
| `X-Quiksend-Timestamp`   | Unix seconds when signed        |
| `X-Quiksend-Event`       | Event type string               |

## Signature verification

The signature covers `timestamp + "." + deliveryId + "." + JSON.stringify(payload)` using the endpoint secret generated at registration time.

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function verifyQuiksendWebhook(input: {
  payload: unknown;
  secret: string;
  timestamp: number;
  signature: string;
  deliveryId: string;
}): boolean {
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - input.timestamp) > 300) return false;

  const body = `${input.timestamp}.${input.deliveryId}.${JSON.stringify(input.payload)}`;
  const expected = createHmac("sha256", input.secret)
    .update(body)
    .digest("hex");

  if (input.signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(input.signature), Buffer.from(expected));
}
```

## Retries

Failed deliveries retry with exponential backoff: **1m → 5m → 30m → 3h → 12h** (5 attempts total). Dead deliveries mark the endpoint `error`.

## SSRF protection

In production, webhook URLs must be public HTTPS endpoints. Private IP ranges and localhost are rejected.
