# Getting started with Quiksend

**A complete walkthrough for running Quiksend locally on your machine.**

This guide assumes zero prior knowledge. If you already know Node/Docker/pnpm, skip
straight to [Get the code](#step-2-get-the-code); otherwise, follow every section in
order and you'll have Quiksend running in about 20 minutes.

By the end of this guide, you will have:

- Quiksend running at `http://localhost:3000`
- A Postgres database with a fresh Quiksend schema
- A local mail sink (Mailpit) at `http://localhost:8025`
- Your own workspace and a mailbox that can send test emails

If anything goes wrong, jump to [Troubleshooting](#troubleshooting) at the bottom.

---

## Who this guide is for

- **Trying Quiksend locally** — a developer, evangelist, or curious founder wanting
  to poke the product before deciding to self-host or contribute.
- **New contributors** — engineers preparing to submit their first PR.
- **Self-hosting evaluators** — technical teams sizing up Quiksend before running
  it on their infrastructure. When done here, see
  [`docs/self-host.md`](./self-host.md) for the production deployment recipe.

**Not for production.** This guide sets up a development environment with a local
Postgres, a local mail sink, and no real credentials. Do NOT expose this setup to
the internet.

---

## What Quiksend is (30-second overview)

Quiksend is an open-source, self-hostable sales engagement platform. Think of it as
an alternative to Outreach.io or Salesforge.ai that runs on your own machine or
server. It lets you send AI-personalized email sequences to prospects, tracks their
replies, syncs with Salesforce/HubSpot, and includes enterprise-grade deliverability
tooling that detects secure email gateways (SEGs) and routes around them.

It's licensed under [AGPL-3.0](../LICENSE) and consists of two main services:

- A **web app** where you configure sequences and prospects
- A **worker** that runs in the background sending emails, syncing CRMs, and polling
  mailboxes for replies

Both talk to a shared Postgres database.

---

## Step 0: What you'll be running

For local development, four things run on your machine at once:

| Service             | Address               | What it does                                                                  |
| ------------------- | --------------------- | ----------------------------------------------------------------------------- |
| **Quiksend Web**    | http://localhost:3000 | The UI you interact with                                                      |
| **Quiksend Worker** | (background process)  | Sends emails, processes jobs                                                  |
| **Postgres**        | localhost:5432        | Database (runs in Docker)                                                     |
| **Mailpit**         | http://localhost:8025 | Local mail catcher — sends land here instead of real inboxes (runs in Docker) |

Postgres and Mailpit run inside Docker containers. Quiksend Web and Worker run
directly on your machine using Node.js. This mirrors production, where only the
Node processes change.

---

## Step 1: Install prerequisites

You need four things installed on your machine before you start:

1. **Git** — to download the code
2. **Node.js** (version 24.18 or later) — the runtime that runs Quiksend
3. **pnpm** (version 11.9 or later) — package manager (like npm or yarn)
4. **Docker Desktop** — runs Postgres and Mailpit in isolated containers

### 1.1. Git

**Check if you already have it:**

```bash
git --version
```

You should see something like `git version 2.x.x`. If you get "command not found":

- **macOS**: Xcode Command Line Tools ships Git. Run `xcode-select --install` in
  Terminal, click Install in the popup, wait ~5 minutes.
- **Linux (Debian/Ubuntu)**: `sudo apt update && sudo apt install git`
- **Linux (Fedora/RHEL)**: `sudo dnf install git`
- **Windows**: Download from [git-scm.com/download/win](https://git-scm.com/download/win)
  and use all the defaults during installation.

### 1.2. Node.js (version 24.18 or later)

**Check if you already have it:**

```bash
node --version
```

You need `v24.18.0` or later. If you have an older version or none at all, install
via **nvm** (Node Version Manager) — this is the safest way because Quiksend pins
an exact Node version in `.nvmrc` and nvm respects that.

**macOS or Linux:**

```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

# Close and reopen your terminal, then:
nvm install 24.18.0
nvm use 24.18.0
node --version   # should print v24.18.0
```

**Windows:**

Install [nvm-windows](https://github.com/coreybutler/nvm-windows/releases) —
download the `nvm-setup.exe` from the latest release. After install:

```powershell
nvm install 24.18.0
nvm use 24.18.0
node --version
```

### 1.3. pnpm (version 11.9 or later)

Node 24 ships with a tool called **Corepack** that manages pnpm automatically. Just
run:

```bash
corepack enable
```

That's it. When you run any `pnpm` command inside Quiksend later, Corepack will
automatically download and use the exact pnpm version pinned in the repo
(`packageManager` in `package.json`).

**Check it works:**

```bash
pnpm --version
```

Should print `11.9.0` or later.

### 1.4. Docker Desktop

Docker Desktop bundles Docker Engine, Docker Compose, and a nice GUI.

- **macOS**: Download from
  [docs.docker.com/desktop/install/mac-install](https://docs.docker.com/desktop/install/mac-install/)
  and drag `Docker.app` to Applications.
- **Windows**: Download from
  [docs.docker.com/desktop/install/windows-install](https://docs.docker.com/desktop/install/windows-install/)
  and run the installer. It may prompt you to enable WSL 2 — accept.
- **Linux**: Install Docker Engine + Docker Compose plugin —
  [docs.docker.com/engine/install](https://docs.docker.com/engine/install/) — pick
  your distro. On Linux you can skip Docker Desktop.

**Start Docker Desktop** after install (on macOS/Windows). You'll know it's running
when you see the whale icon in your menu bar / system tray.

**Verify it works:**

```bash
docker --version
docker compose version
```

You should see version numbers for both.

### 1.5. Optional but recommended

- **A code editor** — VS Code, Cursor, or similar. Not required to run Quiksend but
  handy for editing `.env`.
- **`openssl`** — comes preinstalled on macOS/Linux; on Windows it comes with Git
  Bash. You'll use it to generate secure random secrets in Step 4.

### Ready check

Run all four version commands. Confirm you see something like this:

```bash
git --version           # git version 2.x.x
node --version          # v24.18.0 or later
pnpm --version          # 11.9.0 or later
docker --version        # Docker version 27.x.x or later
docker compose version  # Docker Compose version v2.x.x or later
```

If all four look good, you're ready. Otherwise, revisit the section above for
whichever tool failed.

---

## Step 2: Get the code

Open a terminal in a directory where you keep code projects (e.g. `~/Projects/` on
macOS/Linux, `C:\Users\<you>\Projects\` on Windows) and run:

```bash
git clone https://github.com/whrit/Quiksend.git
cd Quiksend
```

You now have a folder called `Quiksend` and you're inside it. All commands from
here on should be run from inside this folder.

---

## Step 3: Install dependencies

Quiksend has ~500 npm packages across ~10 workspace packages. pnpm handles the
install:

```bash
pnpm install
```

Expect this to take 1-3 minutes on the first run. You'll see a lot of scrolling —
pnpm resolving packages, downloading them, and linking them. When it's done, you'll
see something like:

```
devDependencies:
+ @types/node 26.0.1
+ oxfmt 0.57.0
+ oxlint 1.72.0
...
Done in 2.5s using pnpm v11.9.0
```

**If pnpm asks about a script wanting to run** (e.g. "Do you approve puppeteer to
run install scripts?"), press `a` and Enter to approve all. These are legitimate
build-time scripts from dependencies.

---

## Step 4: Set up your environment file

Quiksend reads configuration from a file called `.env` in the project root.
There's a `.env.example` template — copy it:

```bash
# macOS / Linux
cp .env.example .env

# Windows PowerShell
Copy-Item .env.example .env
```

Now open `.env` in your editor. You'll see a lot of variables, most of them
commented out. For a local demo, **you only need to set one**:

### `BETTER_AUTH_SECRET`

This is a random string that Quiksend uses to sign your session cookie. Generate a
random one:

**macOS / Linux / Git Bash on Windows:**

```bash
openssl rand -base64 32
```

That prints a 44-character random string. Copy it. In `.env`, find:

```bash
BETTER_AUTH_SECRET=
```

Paste your secret after the `=`:

```bash
BETTER_AUTH_SECRET=aBc123XYZ...long-random-string...
```

Save the file.

### Optional: unsubscribe token secret

`.env.example` already sets a dev-only unsubscribe token:

```bash
UNSUBSCRIBE_TOKEN_SECRET=dev-unsubscribe-token-secret
```

This is fine for local testing. Do NOT use this exact value in production.

### That's it for now

The other variables in `.env.example` (Nango, OpenAI/Anthropic, SMTP, Sentry, etc.)
are all optional for a local demo. You can wire them up later once you want to try
CRM sync, AI generation, or real email sending.

---

## Step 5: Start local infrastructure

Fire up Postgres and Mailpit in Docker containers:

```bash
docker compose up -d
```

`-d` means "detached" (background). Docker downloads the images the first time
(~200MB), then starts them. You'll see:

```
[+] Running 2/2
 ✔ Container quiksend-postgres  Started
 ✔ Container quiksend-mailpit   Started
```

**Verify they're running:**

```bash
docker compose ps
```

Both `quiksend-postgres` and `quiksend-mailpit` should show `Up` status.

- **Postgres** is now listening on `localhost:5432` with username/password
  `quiksend/quiksend` (per `docker-compose.yml`).
- **Mailpit** has two ports: `1025` for SMTP (Quiksend sends here) and `8025` for
  the web UI where you can view caught emails.

You can visit http://localhost:8025 right now to see Mailpit's inbox — it'll be
empty until you send an email later.

---

## Step 6: Set up the database

The Postgres container is running but has no Quiksend tables yet. Apply the
migrations:

```bash
pnpm db:migrate
```

You'll see:

```
[HH:MM:SS] INFO: Running migrations
    migrationsFolder: "/path/to/Quiksend/packages/db/drizzle"
[HH:MM:SS] INFO: Migrations complete
```

This creates all the tables Quiksend needs (users, workspaces, prospects,
sequences, mailboxes, and everything else, including the Phase 11 deliverability
tables).

---

## Step 7: (Optional) Seed demo data

If you want to see Quiksend with data in it (a sample sequence, some prospects,
etc.):

```bash
pnpm db:seed
```

**Note:** The seed doesn't create a login for you — it creates a demo workspace
called `demo@quiksend.local` that you'll see once you sign up with your own
account. You still need to sign up in Step 9.

You can skip this step if you'd rather start with an empty workspace.

---

## Step 8: Start Quiksend

Quiksend has two processes that both need to be running:

- **Web** — serves the UI at `localhost:3000`
- **Worker** — runs jobs in the background (sending emails, polling, etc.)

You need **two terminal windows** (or two tabs) open to run both simultaneously.
Both must stay running while you use Quiksend.

### Terminal 1: start the web app

```bash
pnpm web:dev
```

Wait until you see something like:

```
VITE v8.x.x ready in 604 ms
? Local:   http://localhost:3000/
? Network: use --host to expose
```

The web app is now running.

### Terminal 2: start the worker

Open a **new terminal window** (keep the first one running), navigate back to the
Quiksend folder, and run:

```bash
pnpm worker:dev
```

You should see:

```
[HH:MM:SS] INFO: Quiksend worker starting
[HH:MM:SS] INFO: Database connection OK
[HH:MM:SS] INFO: Worker ready
```

**Keep both terminals open.** You'll interact with Quiksend through your browser
while these run.

---

## Step 9: Sign up and create your workspace

Open your web browser and go to:

```
http://localhost:3000
```

You'll be redirected to the login page (`/login`). Click **Create account** at the
bottom of the form.

### Sign up

- **Name**: Your name (or whatever you want)
- **Email**: Any valid-looking email address (doesn't need to be real for local
  testing — try `you@example.com`)
- **Password**: Anything at least 8 characters

Click **Sign up**. You'll be logged in and redirected to onboarding.

### Create your workspace

Onboarding asks for a workspace name. Enter anything, e.g. "My Workspace" or "Test
Company". Click **Create**.

You're now in your workspace. This is where Quiksend's UI lives.

---

## Step 10: Add a mailbox

Sequences need a mailbox to send from. For local testing, you'll use Mailpit as a
fake SMTP server so nothing goes to real inboxes.

Go to **Settings → Mailboxes → Add mailbox**.

Choose **SMTP** (the third tab, since you don't have Gmail/Microsoft OAuth set up).

Fill in:

| Field            | Value                                        |
| ---------------- | -------------------------------------------- |
| **From address** | `you@quiksend.local` (any fake address)      |
| **From name**    | Your name or company                         |
| **Reply-to**     | Leave blank                                  |
| **SMTP host**    | `localhost`                                  |
| **SMTP port**    | `1025`                                       |
| **Username**     | (leave blank — Mailpit doesn't require auth) |
| **Password**     | (leave blank)                                |
| **Use TLS**      | Off                                          |

Click **Add mailbox**. Quiksend will save it. Status should be `active`.

---

## Step 11: Send your first email

The fastest way to see Quiksend send: create a prospect and enroll them in a
sequence.

1. **Create a prospect**: Prospects → Add prospect. Fill in first name, last name,
   and email — anything works, e.g. `test@example.com`. Save.

2. **Create a sequence**: Sequences → New sequence. Give it a name. Add a step:
   choose **manual email**, write a short subject and body. Save.

3. **Enroll the prospect**: Open the prospect, click **Enroll in sequence**, pick
   the sequence you just made, pick the mailbox you added in Step 10. Confirm.

4. **Send the manual step**: Sequences → your sequence → open the enrollment →
   click **Compose**. Write the message or accept the template. Click **Send**.

5. **Check Mailpit**: Go to http://localhost:8025 in a new browser tab. Your email
   should appear in the inbox within a few seconds. Click it to see the full
   rendered email including the compliance footer, unsubscribe link, and
   Message-ID headers.

**If your email arrives in Mailpit** — congratulations, Quiksend is fully working
locally. 🎉

---

## Common commands cheatsheet

Once you're set up, these are the commands you'll use day to day:

| Command                  | What it does                                     |
| ------------------------ | ------------------------------------------------ |
| `pnpm web:dev`           | Start the web app (Terminal 1)                   |
| `pnpm worker:dev`        | Start the worker (Terminal 2)                    |
| `docker compose up -d`   | Start Postgres + Mailpit                         |
| `docker compose down`    | Stop Postgres + Mailpit (data persists on disk)  |
| `docker compose down -v` | Stop and **wipe** Postgres data                  |
| `pnpm db:migrate`        | Apply new database migrations                    |
| `pnpm db:studio`         | Visual database browser at http://localhost:4983 |
| `pnpm db:seed`           | Insert demo workspace + prospects                |
| `pnpm check`             | Full CI gate: lint + format + typecheck + tests  |
| `pnpm test`              | Run just the tests                               |

---

## What to explore next

Now that Quiksend is running:

- **Try the deliverability features (Phase 11)** — Import 5-10 prospects with real
  domain names (e.g. `contact@microsoft.com`, `sales@salesforce.com`) and watch
  the gateway badges appear in the prospect list within seconds. See
  [`docs/deliverability.md`](./deliverability.md).
- **Wire up a real OAuth mailbox** — Set up a Nango account and connect Gmail or
  Microsoft. See [`docs/nango-setup.md`](./nango-setup.md).
- **Try AI generation** — Add `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` to your
  `.env` and restart, then generate a personalized email for a prospect.
- **Connect a CRM** — Salesforce or HubSpot via Nango. See
  [`docs/nango-setup.md`](./nango-setup.md).
- **Explore the API** — Create an API key in Settings → API keys, then hit
  `http://localhost:3000/api/v1/prospects` with a `Bearer` token. See
  [`docs/api.md`](./api.md).
- **Register a webhook** — Point it at [webhook.site](https://webhook.site) and
  see live events fire. See [`docs/webhooks.md`](./webhooks.md).

For production self-hosting: [`docs/self-host.md`](./self-host.md).

---

## Stopping and cleaning up

**To temporarily stop Quiksend:**

- Terminal 1 (web): press `Ctrl+C`
- Terminal 2 (worker): press `Ctrl+C`
- Postgres + Mailpit keep running in Docker. To stop them too:
  ```bash
  docker compose down
  ```

Everything you did (workspaces, prospects, mailboxes) is saved in the Postgres
volume — restarting picks up where you left off.

**To completely reset (wipe all data):**

```bash
docker compose down -v
```

The `-v` flag deletes the Postgres data volume. Next time you `docker compose up
-d` and `pnpm db:migrate`, you'll get a fresh empty database.

**To completely uninstall Quiksend from your machine:**

1. Stop everything (above)
2. `docker compose down -v` — wipe database
3. Delete the `Quiksend` folder
4. Uninstall Docker Desktop, Node, pnpm, and Git if you don't need them for
   anything else

---

## Troubleshooting

### `pnpm install` fails with peer dependency errors

Try:

```bash
pnpm install --frozen-lockfile
```

If that still fails, delete `node_modules` and lockfile isn't right for your Node
version — but usually the fix is confirming you're on Node 24.18+.

### `docker compose up -d` says "Cannot connect to the Docker daemon"

Docker Desktop isn't running. On macOS/Windows, open Docker Desktop from
Applications / Start Menu and wait for the whale icon to appear. Then retry.

### `pnpm db:migrate` fails with "connection refused"

The Postgres container isn't running or isn't ready yet. Check:

```bash
docker compose ps
```

If `quiksend-postgres` isn't `Up`, run `docker compose up -d` again. If it's `Up`
but recently started, wait 10 seconds and retry — Postgres takes a moment to
accept connections.

### Web app at `localhost:3000` says "cannot GET /"

The web dev server is starting up. Wait until the terminal shows `VITE ... ready
in ...`. If it never shows up:

- Terminal shows an error about `BETTER_AUTH_SECRET`: you forgot to fill it in
  in `.env`. Add it, save, and restart with `Ctrl+C` then `pnpm web:dev`.
- Terminal shows "port 3000 in use": something else on your machine has taken
  port 3000. Either stop that thing or `PORT=3001 pnpm web:dev`.

### Emails don't appear in Mailpit

Check both terminals for errors:

- If **worker terminal** shows nothing: the worker isn't running. Start it in
  Terminal 2.
- If **worker terminal** shows an SMTP error: verify the mailbox SMTP settings
  in Quiksend match Mailpit's defaults (host=`localhost`, port=`1025`, no auth,
  no TLS).
- If **worker terminal** shows the send succeeded but Mailpit is empty: refresh
  Mailpit at http://localhost:8025.

### `pnpm web:dev` shows lots of TypeScript errors

If you just cloned the repo, run `pnpm install` again to make sure workspace
symlinks are set up correctly. If errors persist, run `pnpm check` — this is the
CI gate; if it passes here it should work.

### Docker containers won't start

Check what's using port 5432 (Postgres) or 1025 (Mailpit's SMTP):

```bash
# macOS/Linux
lsof -i :5432
lsof -i :1025

# Windows
netstat -ano | findstr :5432
```

If something else is using them, stop that service or edit `docker-compose.yml` to
change the exposed ports.

### Something else

- Search open issues: [github.com/whrit/Quiksend/issues](https://github.com/whrit/Quiksend/issues)
- Full operational runbooks: [`docs/troubleshooting.md`](./troubleshooting.md)
- Ask a question by opening a new issue with the label `question`

---

## Learn how Quiksend is built

If you're technical and want to understand what's happening under the hood:

- [`docs/architecture.md`](./architecture.md) — Data flow diagram
- [`CLAUDE.md`](../CLAUDE.md) — Package layout + conventions (targets both humans
  and coding agents)
- [`docs/implementations/phases/`](./implementations/phases/) — The full phase-by-phase
  build history that got Quiksend to where it is today

---

## Getting help

- **Bugs or unexpected behavior**: [Open an issue](https://github.com/whrit/Quiksend/issues/new)
- **Questions**: Search or open an issue labeled `question`
- **Contributions welcome**: See [`CLAUDE.md`](../CLAUDE.md) and
  [`RELEASING.md`](../RELEASING.md) for conventions before opening a PR

Have fun building. 🚀
