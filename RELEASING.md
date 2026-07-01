# Releasing Quiksend

Quiksend versions **the whole app as one unit** using
[Release Please](https://github.com/googleapis/release-please) driven by
[Conventional Commits](https://www.conventionalcommits.org/). Versioning and the
changelog are automated from commit history — you never bump a version or edit
`CHANGELOG.md` by hand.

## Why this method (and not Changesets)

Changesets is built for publishing independently-versioned **npm packages**.
Every package here is `private: true` and ships as source inside the app — nothing
is published to a registry — so the release unit is the application (a Git tag +
GitHub Release + image), not a package. Release Please fits that exactly.

If a genuinely public package appears later (a Logo API SDK, an extracted
`packages/ui`), add Changesets **scoped to that package** and keep Release Please
for the app. They coexist.

## The loop

1. Open PRs with Conventional Commit **titles** (`feat: …`, `fix: …`). The
   `lint-pr` workflow enforces this.
2. Merge them to `main` (see merge strategy below).
3. Release Please keeps an open **release PR** titled `chore(main): release X.Y.Z`,
   accumulating the changelog and the version bump as more PRs land.
4. When you want to ship, **merge the release PR**. That is the release: Release
   Please tags `vX.Y.Z`, publishes a GitHub Release with notes, and updates
   `CHANGELOG.md` + `.github/.release-please-manifest.json` + root `package.json`.

## Commit types → changelog

| Type                              | Bump  | Changelog section |
| --------------------------------- | ----- | ----------------- |
| `feat`                            | minor | Features          |
| `fix`                             | patch | Bug Fixes         |
| `perf`                            | patch | Performance       |
| `deps`                            | patch | Dependencies      |
| `refactor`                        | patch | Refactors         |
| `docs`                            | patch | Documentation     |
| `build` / `ci` / `test` / `chore` | patch | hidden            |

A breaking change (`feat!:` / `fix!:`, or a `BREAKING CHANGE:` footer) bumps the
minor while pre-1.0 (configured via `bump-minor-pre-major`), and the major once
you're at 1.0+.

## Versioning scheme

SemVer, starting in `0.x`. The manifest starts at `0.0.0`; the first release PR
proposes the first real version from the commits it finds (a `feat` history →
`0.1.0`). Force a specific version with a `Release-As` footer, e.g. a commit:

```
chore: cut first stable

Release-As: 1.0.0
```

## Merge strategy (important)

Use **Squash & merge**, and in repo Settings → General → Pull Requests, enable
**"Default to PR title for squash merge commits."** Then the squashed commit that
lands on `main` is the (already-linted) PR title, which is what Release Please
reads. If you use merge commits instead, make sure every individual commit is
conventional.

## First-time setup

1. Commit these files to `main`.
2. Settings → Actions → General → **Workflow permissions**: allow
   "Read and write permissions" and "Allow GitHub Actions to create and approve
   pull requests" (Release Please opens the release PR).
3. Push a `feat:`/`fix:` commit (or open+merge a PR). Release Please opens the
   release PR within a minute.

## Tokens: GITHUB_TOKEN vs PAT

The default `GITHUB_TOKEN` creates the release PR, tag, and GitHub Release — enough
for the common case. Two known limitations, both by GitHub's anti-recursion design:

- Other workflows' `on: pull_request` **won't run on the release PR**, so the CI
  gate is skipped there. That's usually fine (it only bumps version + changelog).
- A tag pushed by `GITHUB_TOKEN` **won't trigger a separate `on: push: tags`**
  workflow.

If you want CI on the release PR, or tag-triggered workflows, create a fine-grained
PAT with `contents: write` + `pull-requests: write`, store it as
`RELEASE_PLEASE_TOKEN`, and uncomment the `token:` line in `release-please.yml`.
Otherwise, **chain CD inside `release-please.yml`** gated on
`needs.release-please.outputs.release_created` (the commented `release-artifacts`
job is the placeholder) — that path needs no PAT.

## Optional: enforce commits locally

The CI `lint-pr` check is the source of truth. If you also want fast local
feedback, add commitlint + a git hook:

```bash
pnpm add -Dw @commitlint/cli @commitlint/config-conventional
echo "export default { extends: ['@commitlint/config-conventional'] };" > commitlint.config.js
# then wire a commit-msg hook (husky, lefthook, or a plain .git/hooks script)
```

## Container images (CD)

On every release, the `release-images` job in `release-please.yml` builds and
pushes two images to GitHub Container Registry (GHCR):

- `ghcr.io/<owner>/quiksend-web` — the TanStack Start app (Nitro node-server;
  `.output` is self-contained). Listens on `PORT` (default 3000).
- `ghcr.io/<owner>/quiksend-worker` — the background worker (runs the TS source
  via `tsx`).

Each is tagged with the release tag (e.g. `v0.1.0`), `latest`, and `sha-<short>`.
Both build from a `turbo prune`d subset of the monorepo, so each image only
contains the workspace packages it actually needs.

```bash
docker pull ghcr.io/<owner>/quiksend-web:v0.1.0
docker run --rm -p 3000:3000 \
  -e DATABASE_URL=... -e BETTER_AUTH_SECRET=... -e BETTER_AUTH_URL=... \
  ghcr.io/<owner>/quiksend-web:v0.1.0
```

Notes:

- GHCR packages are **private** by default. Make them public, or grant pull
  access, under the package settings / repo → Packages.
- No PAT needed — the job pushes with the built-in `GITHUB_TOKEN` (it has
  `packages: write`).
- Both images are single-arch (`linux/amd64`). For arm64 too, add
  `docker/setup-qemu-action@v4` and `platforms: linux/amd64,linux/arm64`.
- **Migrations are not run by these images.** Apply `pnpm db:migrate` (or a
  one-off job/`release-images`-adjacent step) against your database before/at
  deploy — the web/worker containers assume the schema already exists.

### Deploy (the remaining hop)

Deployment is intentionally not wired yet (chosen: publish images for now). When
ready, add a `deploy` job with `needs: release-images` that pulls the tagged
images onto the target (DigitalOcean droplet via SSH + compose, DO App Platform,
etc.). The worker is a long-running process; the web image is a standard Node
server behind whatever ingress you choose.
