# Mergio-26

A Turborepo monorepo with a Next.js app, a shared UI library and a Prisma 7 + PostgreSQL database package.

## Project structure

```
apps/
  web/                    Next.js 16 app (http://localhost:3001)
  super-admin/            Next.js 16 super admin dashboard (http://localhost:3002)
  backend/                Express 5 + TypeScript API (http://localhost:4000)
packages/
  db/                     Prisma 7 schema, migrations and the shared `prisma` client
  scoring/                Scoring engine (pure, unit-tested) and shared ranking/queue helpers
  ui/                     Shared React components (Tailwind CSS v4)
  tailwind-config/        Shared Tailwind theme and PostCSS config
  eslint-config/          Shared ESLint configs
  typescript-config/      Shared tsconfig files
docker-compose.yml        Local PostgreSQL and Redis for development
```

## Prerequisites

- [Node.js](https://nodejs.org/) 24 or newer
- [pnpm](https://pnpm.io/) (`npm install -g pnpm` or `corepack enable`)
- A PostgreSQL database. See [Database setup](#database-setup) for options.

## Getting started

### 1. Clone and install

```sh
git clone git@github.com:TheCodeHeist-Coder/Mergio-26.git
cd Mergio-26
pnpm install
```

### 2. Configure environment variables

```sh
cp packages/db/.env.example packages/db/.env
cp apps/web/.env.example apps/web/.env
```

Both files need the same `DATABASE_URL`. Prisma reads `packages/db/.env`, and the Next.js app reads `apps/web/.env`. The default value matches the Docker setup below. If you use a different database, change it in both files.

`apps/web/.env` also holds the sign-in settings. Fill them in using [GitHub sign-in](#github-sign-in) below.

### 3. Set up the database

Choose one of the [database options](#database-setup), then create the tables:

```sh
pnpm db:migrate
```

### 4. Start the dev server

```sh
pnpm dev
```

The web app runs at http://localhost:3001 and the super admin app at http://localhost:3002.

To run only one app, use `pnpm dev --filter web` or `pnpm dev --filter super-admin`.

The super admin app and the backend also need their own `.env`:

```sh
cp packages/db/.env.example apps/super-admin/.env
cp apps/backend/.env.example apps/backend/.env
```

The backend API runs at http://localhost:4000. `GET /health` checks that the server and database are up.

## GitHub sign-in

Registration uses [Better Auth](https://www.better-auth.com) with GitHub as the only provider. We request only `read:user` and `user:email`, never repository access.

1. On GitHub, go to **Settings > Developer settings > OAuth Apps > New OAuth App**.
2. Set **Homepage URL** to `https://mergio.in`. Under **Redirect URIs** add `http://localhost:3001/api/auth/callback/github` and `https://mergio.in/api/auth/callback/github`. Leave wildcard matching, device flow and token expiry off.
3. Copy the **Client ID** into `GITHUB_CLIENT_ID`. Generate a **Client secret** and copy it into `GITHUB_CLIENT_SECRET`.
4. Generate `BETTER_AUTH_SECRET` with `openssl rand -base64 32`, and set `BETTER_AUTH_URL="http://localhost:3001"`.
5. Optional: list GitHub usernames in `ADMIN_GITHUB_LOGINS` (comma separated) to make them admins the next time they sign in.

The same app serves dev and production because it has both redirect URIs. Each environment sets its own `BETTER_AUTH_URL` (`http://localhost:3001` locally, `https://mergio.in` in production), and Better Auth builds the redirect URI from it. Both environments share one client secret, so give teammates a separate dev app once more than one person runs the project locally. In production, also set `AUTH_COOKIE_DOMAIN=".mergio.in"` so the session cookie is shared with `admin.mergio.in`.

Sign-in is checked in two places. `apps/web/proxy.ts` only looks for a session cookie and redirects early. The real check is `requireUser()` in `apps/web/lib/dal.ts`, so call it in every page and action that needs a signed-in user.

### Roles and registration

People pick any of **Contributor**, **Maintainer** and **Mentor** and can hold several. Each role is its own `Registration` row with a status. Contributors are `APPROVED` immediately. Maintainers and mentors start as `PENDING` until an admin reviews them. Shared details (college, graduation year, phone, Discord) live in one `Profile` per person.

### Project applications

Maintainers apply with a project at `/projects/new` (issue #23, F-04). An application is saved as a draft, then submitted for review. Saving looks each repo up on GitHub and stores its permanent repo id, so renamed or transferred repos keep working. Submitting runs every check again and only succeeds when each repo is public, not archived, has an OSI-approved license, a README and a CONTRIBUTING file, and the applicant has admin or maintain permission on it.

The checks use the applicant's own GitHub sign-in token (`read:user`, `user:email`), so no extra GitHub permissions are needed. If a repo belongs to an organization that restricts OAuth apps, an owner of that organization has to approve the Mergio OAuth app before the permission check can pass.

Approved projects with at least one accepted repo are listed at `/projects`. Projects belong to a `Season`; the migration seeds Winter 2026 as the active one.

Admins (`User.isAdmin`) review applications at `/admin/projects`. An application moves draft → submitted → under review → changes requested or approved or rejected; the project admin resubmits after changes are requested. Every change is recorded in `ProjectReview` (who, when, an internal note only organizers see, and the public reason shown to the project admin), and every status change emails the project admin. A project can't be approved without a repo.

After approval the project admin can still edit the description and tech stack, add repos and remove them (`/projects/{slug}/manage`). A repo added after approval has to pass every check and then waits for an organizer, who accepts or rejects it on the review page ("Repo requests" in the queue). Removing a repo keeps its row (`removedAt`), so points already earned stay and only future scoring stops; the last accepted repo can't be removed. Each repo shows whether the Mergio GitHub App tracks it ("Tracking active" or "App not installed"); the GitHub App's installation webhooks (F-06) set that, and `GITHUB_APP_SLUG` adds an install link. Returning projects re-apply each season with "Copy to …" on `/projects/new`.

### Projects API

JSON endpoints under `/api/v1`, authenticated with the same session cookie as the site. Writes must send `Content-Type: application/json` (cross-site forms can't, which protects against CSRF). Errors look like `{"error": {"message", "fields"?, "repoProblems"?}}`. GitHub repo ids are strings.

| Method and path | Who | What |
| --- | --- | --- |
| `GET /projects?tag=Rust` | anyone | Live projects of the active season |
| `GET /projects/{slug}` | anyone (live), owner and organizers (any status) | One project |
| `POST /projects` | maintainers | Create a draft; `techStack` and `repos` may be arrays |
| `PATCH /projects/{id}` | owner | Change fields; only `description` and `techStack` once approved |
| `POST /projects/{id}/submit` | owner | Re-check repos and submit for review |
| `POST /projects/{id}/repos` | owner | Add a repo: `{"url": "https://github.com/owner/repo"}` |
| `DELETE /projects/{id}/repos/{repoId}` | owner | Remove a repo |
| `GET /projects/{id}/install-status` | anyone (live), owner and organizers | GitHub App tracking per repo |
| `GET /admin/projects/{id}/review` | organizers | Application, history and allowed decisions |
| `POST /admin/projects/{id}/review` | organizers | `{"decision", "seenStatus"?, "publicReason"?, "internalNote"?}` |

### PR tracking and scoring

Merged pull requests on tracked repos are scored automatically (issues #25 F-06 and #26 F-07):

1. GitHub sends webhooks to `POST /api/v1/webhooks/github` (in `apps/web`). It checks `X-Hub-Signature-256`, stores the delivery in `WebhookDelivery` (the delivery id is the key, so redeliveries are ignored), queues a `SyncJob` and answers 202. Nothing is processed in the request.
2. The sync worker (in `apps/backend`, started with the API) claims jobs from the Postgres queue, refetches the PR from GitHub in one GraphQL call (labels, merge info, approving reviews, the issues it closes, label history), stores it in `PullRequest` and scores it.
3. Scoring is `evaluatePullRequest()` in `packages/scoring`: a pure function that decides whether the PR counts and what it is worth, with one of 14 fixed reason codes when it doesn't. The difference between that and what the PR already has on the ledger is appended to `ScoreEvent`. Entries are never edited: a relabel, a late bonus, an invalid or spam label or a revert within 7 days each add a new entry or a reversal, so scoring is idempotent and seeing a PR twice never double counts.
4. Nightly at 03:00 IST, every tracked repo is reconciled (PRs updated since the last sync are refetched), which recovers anything a webhook outage missed. PRs merged without a level label wait 72 hours for a mentor to add one, then are scored or marked `NO_LEVEL_LABEL`.

Default labels and points, overridable per season in `Season.scoringRules`: `wos` (program), `level:beginner` 10, `level:intermediate` 25, `level:advanced` 45, `bonus:quality` +10, `bonus:docs` +5, `bonus:tests` +5, `wos:invalid`, `wos:spam`. The level can come from the issue the PR closes. Caps: 8 beginner PRs per contributor per project, 40 points per contributor per IST day (the overflow counts from the next day), 2 quality bonuses per project per week, and diffs under 3 non-blank lines score as beginner. Three spam strikes suspend a contributor's scoring. The engine's tests: `pnpm --filter @repo/scoring test`.

**Nothing scores until the season has a contribution window.** Until the season admin page (F-03) exists, set it with:

```sh
pnpm --filter backend season:window 2026-12-01 2026-12-31   # IST days; rescores every PR
pnpm --filter backend resync [owner/name]                    # reconcile now instead of nightly
```

#### GitHub App setup

1. **Settings > Developer settings > GitHub Apps > New GitHub App.** Webhook URL: `https://mergio.in/api/v1/webhooks/github` (for local development, a tunnel such as `smee.io` to `http://localhost:3001/api/v1/webhooks/github`). Generate a webhook secret and put it in `GITHUB_WEBHOOK_SECRET` in `apps/web/.env`.
2. Repository permissions: Pull requests (read), Issues (read and write, to create the program labels), Metadata (read), Contents (read). Subscribe to: Pull request, Pull request review, Issues, Label, Repository. Installation events are sent automatically.
3. Put the App ID in `GITHUB_APP_ID` and the generated private key in `GITHUB_APP_PRIVATE_KEY` (one line, `\n` for line breaks) in `apps/backend/.env`, and the app's URL name in `GITHUB_APP_SLUG` in `apps/web/.env` for the install links.

When a project admin installs the app, its repos switch to "Tracking active", the program labels are created and the repos are synced. Uninstalling suspends tracking; points already earned stay. Without the App ID and key, jobs wait in the queue (they are retried hourly) instead of failing.

### Contributor dashboard

Contributors see their points, overall and weekly rank (Monday 00:00 IST), progress to the next badge, their pull requests with status (open, scored, awaiting a label, not eligible with the exact reason, invalidated), a "Raise a dispute" link per merged PR for 7 days after its merge or last score change, and recommended issues at their level. `/dashboard/prs` lists every PR with status, level and project filters; `/dashboard/points` is the ledger with the reason and PR link for each entry.

| Method and path | What |
| --- | --- |
| `GET /me/stats` | Points, held points, rank, weekly rank, PR counts, badges and next-badge progress |
| `GET /me/pull-requests?status=&level=&project=&page=` | The contributor's PRs this season; `status` is `open`, `scored`, `awaiting`, `not-eligible`, `invalidated` or `closed` |
| `GET /me/score-events?page=` | The points ledger, newest first |
| `POST /disputes` | `{"pullRequestId", "category", "text", "evidenceUrls"?}`; one unresolved dispute per PR |

### Mentors and project admins

Project admins add mentors by GitHub username on their project dashboard (`/dashboard/projects/{slug}`, issue #24 F-05). Someone without a Mergio account gets an invite: the row links to them when they sign in, and the page shows the sign-up link to send them. A mentor becomes active once an organizer approves their mentor registration at `/admin/mentors` (they are emailed). Removing a mentor ends their access at once; mentor points they earned stay. Active mentors are listed on the public project page, and project staff (the admin and active mentors) can't score as contributors on their own project (`AUTHOR_IS_MENTOR`).

**Mentor view** (`/dashboard/mentor`, for mentors and project admins): the projects they mentor, merged PRs waiting for a label (urgent while inside the 72-hour window, soonest deadline first; ones past it still score when labelled), recently scored PRs, their mentor points, a warning for repos where their GitHub role is below triage, and "Flag the author" on each PR.

**Project admin view** (`/dashboard/projects/{slug}`): repo health (accepted, GitHub App installed, program labels present), mentors with their status and missing triage permission, PR stats, contributors by points, recent PRs, and links to edit the project and repos.

Mentor points (PRD §4.5) are a separate ledger, `MentorPointEvent`: +5 per approving review on a PR that scores, and +2 when an issue the mentor labelled (the level label, else the program label) gets a scored PR. They are taken back if the PR stops scoring. The worker checks each mentor's GitHub role per repo when they are added or approved and nightly (needs the app's Metadata read permission), and records which program labels each repo still lacks.

| Method and path | Who | What |
| --- | --- | --- |
| `GET /mentor/queue` | mentors, project admins | Merged PRs on your projects that need a label |
| `POST /projects/{id}/mentors` | project admin, organizers | `{"githubLogin"}`; returns the mentor's state and an `inviteUrl` when they need to sign up |
| `DELETE /projects/{id}/mentors/{mentorId}` | project admin, organizers | Removes a mentor |
| `POST /flags` | project staff, organizers | `{"pullRequestId", "category", "note"}`; flags the PR's author for organizers |
| `GET /admin/participants?role=mentor&status=pending` | organizers | Mentor or maintainer registrations |
| `POST /admin/participants/{id}/review` | organizers | `{"decision": "APPROVED" \| "REJECTED"}` |

### Leaderboards

Public boards at `/leaderboard` (issue F-08): overall, this week (resets Monday 00:00 IST), per project, colleges, and mentors, plus each college's students at `/leaderboard/colleges/{slug}`. Rows show rank, the change since 00:00 IST today, name and avatar, college, points, scored PRs by level and the top three badges. Search by name or GitHub login, filter by college, state and graduation year, 50 rows a page, and "Jump to me".

**One ordering everywhere.** Every board, the dashboard rank and the SQL reference rank by: more points, more advanced PRs, more intermediate PRs, whoever reached that total first, then ascending id. Mentors have no PR levels, so for them it is points, reached first, then id. No two entries share a rank. The rule lives in `compareStandings()` in `packages/scoring/src/leaderboard.ts`.

**Redis in front, Postgres as the record.** Boards are Redis sorted sets whose members encode the standing so that byte order is the ranking. A missing board is rebuilt from the ledger (`packages/scoring/src/server/leaderboard/sql.ts`). Each ledger write queues a `LEADERBOARD_REFRESH` job in the same transaction; the worker re-reads that person's standing from SQL and swaps their entries. Points held by the daily cap are refreshed when they take effect. Every read falls back to Postgres if Redis is unset or failing. Configure `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` for the web app on Vercel, and `REDIS_URL` (`rediss://` for Upstash over TLS) for the worker. Locally `docker compose up -d` also starts Redis on port 6380.

**Freeze and finalize (PRD §4.8).** The board freezes by itself 48 hours before coding ends: a snapshot of every board is stored in Postgres and every rank shown (public boards, the API and contributors' dashboards) comes from it, while scoring carries on. Organizers can freeze, unfreeze (which also turns the automatic freeze off) and finalize at `/admin/leaderboard`. Finalizing takes a final snapshot and locks the ledger: no points, mentor points or badges are written. Only a Super Admin (`SUPER_ADMIN_GITHUB_LOGINS`, applied on sign-in) can unfinalize. PRs that arrived while it was finalized are scored on the next nightly resync.

**Colleges.** `College` is a curated list (AICTE-approved technical institutions, UGC-recognised universities, and ones organizers add) with a state for filtering. Registration suggests colleges as people type; picking one links the profile. Anything typed instead is kept and can be mapped by an organizer at `/admin/leaderboard` (a `CollegeAlias`, which applies to everyone who typed that name). Import a dataset with `pnpm --filter backend colleges:import <file.csv>`; the expected columns are documented at the top of `apps/backend/src/scripts/colleges-import.ts`, and `apps/backend/data/colleges.dev.csv` is a small fixture for local work.

| Method and path | Who | What |
| --- | --- | --- |
| `GET /leaderboards/{board}?page=&q=&college=&state=&gradYear=` | anyone | `{board}`: `overall`, `weekly`, `mentors`, `colleges`, `project:{slug}`, `college:{slug}` |
| `GET /leaderboards/{board}/me` | signed in | Your row and its page (your college's on `colleges`) |
| `POST /admin/leaderboard/{freeze\|unfreeze\|finalize\|unfinalize\|rebuild}` | organizers | JSON body (`{}`); `unfinalize` needs a Super Admin |
| `GET /colleges?q=` | anyone | Up to 10 colleges, for the autocomplete |

Checks: `pnpm --filter backend leaderboard:verify` compares every live board with a fresh SQL computation (the worker also does this nightly and rebuilds any that differ). For load testing, `leaderboard:seed --yes` makes a 20,000-user `loadtest` season active, `leaderboard:load --base <url>` reports p50/p95/p99, and `leaderboard:seed --drop` removes it and reactivates the previous season.

### Email

Emails are written to the `EmailOutbox` table in the same transaction as the change they report, then sent through [Resend](https://resend.com) right after the response. Set `RESEND_API_KEY` and `EMAIL_FROM` (a sender on a domain verified in Resend) in `apps/web/.env`. Without a key, emails are only queued and logged; rows that are still `PENDING` (no key yet, or a failed attempt) can be sent later, and a retry worker arrives with notifications (F-13).

### Exporting leads

Until the admin dashboard exists, dump every registration to CSV:

```sh
pnpm --silent export:registrations > registrations.csv
```

The file contains personal data. `registrations*.csv` is git-ignored, so keep it that way.

## Database setup

The app works with any PostgreSQL database. Choose one of these options and put its connection string in `DATABASE_URL`.

### Option A: Docker Compose (recommended)

You need [Docker](https://docs.docker.com/get-docker/) installed. From the repo root:

```sh
docker compose up -d
```

This starts PostgreSQL 16 on **port 5433**. That port avoids a clash with any Postgres you already run on 5432. The default URL works as-is:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/mergio?schema=public"
```

Useful commands:

```sh
docker compose ps         # check status
docker compose down       # stop (data is kept)
docker compose down -v    # stop and delete all data
```

### Option B: Plain `docker run`

Use this to run the same database without Docker Compose:

```sh
docker run -d --name mergio-postgres \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=mergio \
  -p 5433:5432 -v mergio-postgres-data:/var/lib/postgresql/data \
  postgres:16-alpine
```

The default `DATABASE_URL` works as-is.

### Option C: PostgreSQL installed locally

Install PostgreSQL with your system package manager (`sudo apt install postgresql`, `brew install postgresql@16`, or the [Windows installer](https://www.postgresql.org/download/windows/)). Then create a database:

```sh
createdb mergio
```

Update `DATABASE_URL` with your local user, password and port (usually 5432):

```
DATABASE_URL="postgresql://<user>:<password>@localhost:5432/mergio?schema=public"
```

### Option D: Hosted PostgreSQL (no local install)

Create a free database on a hosted provider such as [Neon](https://neon.tech), [Supabase](https://supabase.com) or [Prisma Postgres](https://www.prisma.io/postgres). Copy its connection string into `DATABASE_URL`. Hosted providers usually require SSL, so add `?sslmode=require` if the provider's string doesn't already include it.

> Use the **direct** (non-pooled) connection string when running migrations.

## Working with the database

The schema is in [packages/db/prisma/schema.prisma](packages/db/prisma/schema.prisma). After you change it:

```sh
pnpm db:migrate     # create and apply a migration (asks for a name)
```

Other commands:

| Command            | What it does                                            |
| ------------------ | ------------------------------------------------------- |
| `pnpm db:generate` | Regenerate the Prisma client (also runs before `dev`/`build`) |
| `pnpm db:migrate`  | Create and apply a new migration in development         |
| `pnpm db:push`     | Sync the schema without creating a migration (prototyping) |
| `pnpm db:studio`   | Open Prisma Studio to browse and edit data              |

Apply migrations in production with `pnpm --filter @repo/db db:deploy`.

### Using the client

Import the shared client in server-side code only, such as server components, route handlers and server actions:

```ts
import { prisma } from "@repo/db";

const users = await prisma.user.findMany();
```

## Scripts

Run these from the repo root:

| Command            | What it does                         |
| ------------------ | ------------------------------------ |
| `pnpm dev`         | Start all apps in development mode   |
| `pnpm build`       | Build all apps and packages          |
| `pnpm lint`        | Lint all packages                    |
| `pnpm check-types` | Type-check all packages              |
| `pnpm format`      | Format code with Prettier            |

## Troubleshooting

**`OS file watch limit reached` (Linux).** The dev server watches more files than the default limit allows. Raise the limit:

```sh
echo -e "fs.inotify.max_user_watches=524288\nfs.inotify.max_user_instances=512" | sudo tee /etc/sysctl.d/60-inotify.conf
sudo sysctl --system
```

**Strange build or CSS errors after a crash.** Clear the Next.js cache and restart:

```sh
rm -rf apps/web/.next && pnpm dev
```

**`Sign in with GitHub` does nothing or shows an error.** Check that `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are set in `apps/web/.env`, and that the OAuth App's callback URL matches `BETTER_AUTH_URL` exactly. Restart `pnpm dev` after editing `.env`.

**`Can't reach database server`.** Check that your database is running (`docker compose ps` for Docker). Also check that `DATABASE_URL` is the same in `packages/db/.env` and `apps/web/.env`.
