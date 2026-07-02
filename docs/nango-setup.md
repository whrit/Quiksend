# Nango setup for Quiksend

Quiksend uses [Nango Cloud](https://nango.dev) for OAuth and API proxying. You can
self-host Nango instead; the integration keys below must match what Quiksend expects.

## Before you start

1. Sign up at [nango.dev](https://nango.dev) (or deploy [self-hosted Nango](https://nango.dev/docs/guides/self-hosting)).
2. Copy **Secret key** and **Webhook secret** from Environment settings into your
   Quiksend `.env`:

   ```bash
   NANGO_SECRET_KEY=nango_secret_...
   NANGO_WEBHOOK_SECRET=...
   NANGO_PUBLIC_URL=https://your-quiksend-domain.com   # optional redirect base
   ```

3. Register Quiksend's Nango webhook URL in the Nango dashboard:
   `https://<your-domain>/api/nango/webhook`

![screenshot: Nango environment settings with secret key and webhook secret]

## Integration keys (must match Quiksend)

| Quiksend feature  | Nango integration `unique_key` | Nango provider slug |
| ----------------- | ------------------------------ | ------------------- |
| Gmail mailbox     | `google-mail`                  | `google-mail`       |
| Microsoft mailbox | `microsoft`                    | `microsoft`         |
| Salesforce CRM    | `salesforce`                   | `salesforce`        |
| HubSpot CRM       | `hubspot`                      | `hubspot`           |

Quiksend passes these keys in `createConnectSession({ allowed_integrations: [...] })`.
If your Nango integration `unique_key` differs, OAuth will fail in the Connect UI.

## Gmail (`google-mail`)

### 1. Google Cloud OAuth app

1. [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials.
2. Create **OAuth client ID** → Application type **Web application**.
3. **Authorized redirect URI:** `https://api.nango.dev/oauth/callback`
   (Nango's callback — not your Quiksend URL).
4. Enable the **Gmail API** for the project.

![screenshot: Google OAuth client redirect URI set to api.nango.dev/oauth/callback]

### 2. Nango integration

In Nango → Integrations → **Add integration**:

- Provider: **Google Mail** (`google-mail`)
- Integration ID (`unique_key`): **`google-mail`**
- Client ID / Client secret from Google
- Scopes:

  ```
  https://www.googleapis.com/auth/gmail.send
  https://www.googleapis.com/auth/gmail.readonly
  ```

Or create via API ([Nango auth guide](https://nango.dev/docs/guides/auth/auth-guide)):

```bash
curl --request POST \
  --url https://api.nango.dev/integrations \
  --header "Authorization: Bearer $NANGO_SECRET_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "unique_key": "google-mail",
    "provider": "google-mail",
    "credentials": {
      "type": "OAUTH2",
      "client_id": "<GOOGLE-CLIENT-ID>",
      "client_secret": "<GOOGLE-CLIENT-SECRET>",
      "scopes": "https://www.googleapis.com/auth/gmail.send,https://www.googleapis.com/auth/gmail.readonly"
    }
  }'
```

![screenshot: Nango providers page with google-mail integration]

### 3. Connect in Quiksend

1. Settings → **Mailboxes** → **Add mailbox** → **Gmail** tab.
2. Enter the mailbox **From address** (must match the Google account).
3. Click **Connect Gmail** — Nango Connect UI opens (`@nangohq/frontend`).
4. Complete Google consent. Quiksend finalizes the connection server-side.

Inbound reply detection uses Gmail polling via Nango proxy (`packages/mail` Gmail adapter).

## Microsoft (`microsoft`)

### 1. Microsoft Entra app

1. [Azure Portal](https://portal.azure.com/) → Microsoft Entra ID → App registrations → **New registration**.
2. Supported account types: per your tenant needs (single or multi-tenant).
3. Redirect URI — platform **Web:** `https://api.nango.dev/oauth/callback`
4. API permissions → Microsoft Graph → **Delegated**:
   - `Mail.Send`
   - `Mail.Read`
   - `offline_access`
5. Grant admin consent if required by your tenant.

![screenshot: Microsoft app registration redirect URI]

### 2. Nango integration

- Provider: **Microsoft** (`microsoft`)
- Integration ID: **`microsoft`**
- Client ID / Client secret from Entra
- Scopes: `Mail.Send Mail.Read offline_access`

```bash
curl --request POST \
  --url https://api.nango.dev/integrations \
  --header "Authorization: Bearer $NANGO_SECRET_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "unique_key": "microsoft",
    "provider": "microsoft",
    "credentials": {
      "type": "OAUTH2",
      "client_id": "<ENTRA-CLIENT-ID>",
      "client_secret": "<ENTRA-CLIENT-SECRET>",
      "scopes": "Mail.Send Mail.Read offline_access"
    }
  }'
```

### 3. Connect in Quiksend

Same flow as Gmail: Settings → Mailboxes → **Microsoft** tab → enter address →
**Connect Microsoft**.

## Salesforce

1. Create a **Connected App** in Salesforce with OAuth enabled.
2. Callback URL: `https://api.nango.dev/oauth/callback`
3. In Nango, add integration `unique_key`: **`salesforce`**, provider **`salesforce`**.
4. Scopes: typically `api`, `refresh_token`, `offline_access` (match Nango's Salesforce
   template).
5. In Quiksend: Settings → **Integrations** → Connect Salesforce.

Default field mapping lives in `packages/integrations/src/providers/salesforce.ts`;
override per workspace in the connect UI.

![screenshot: Nango Salesforce integration config]

Docs: [Nango Salesforce](https://nango.dev/docs/api-integrations/salesforce)

## HubSpot

1. Create a HubSpot app (or private app) with OAuth.
2. Redirect URL: `https://api.nango.dev/oauth/callback`
3. Nango integration `unique_key`: **`hubspot`**, provider **`hubspot`**.
4. Scopes: `crm.objects.contacts.read`, `crm.objects.companies.read`, and write scopes
   for writeback (see Nango HubSpot template).
5. In Quiksend: Settings → **Integrations** → Connect HubSpot.

![screenshot: HubSpot OAuth redirect in Nango]

Docs: [Nango HubSpot](https://nango.dev/docs/api-integrations/hubspot)

## Troubleshooting OAuth

| Problem                                     | Check                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| Connect UI closes immediately               | `NANGO_SECRET_KEY` set; integration `unique_key` matches table above            |
| `redirect_uri_mismatch` in Google/Microsoft | Redirect must be `https://api.nango.dev/oauth/callback` on the **provider** app |
| Mailbox connects but send fails             | Scopes include send (`gmail.send` / `Mail.Send`)                                |
| Webhook sync stale                          | `NANGO_WEBHOOK_SECRET` matches Nango; URL reachable at `/api/nango/webhook`     |

See also [troubleshooting.md](./troubleshooting.md#mailbox-oauth-or-smtp-failure).
