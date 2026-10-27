# CampusFlow

Multi-tenant school management SaaS with a computer-based testing (CBT) exam
module — one Next.js application, one MongoDB.

A tenant owns one or more schools; every user is either **staff** (proprietor,
administrator, teacher) or a **learner**. Staff manage classes, learners,
attendance, fees and exams from the dashboard; learners sit timed CBT exams,
track attendance and pay fees from their own view.

---

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 15 (App Router) + React 19 + TypeScript |
| Database | MongoDB + Mongoose 8 (cached connection, declared indexes) |
| Validation | Zod on every request body and query string |
| Auth | JWT session cookie (`cf_session`) signed with `jose`, bcryptjs hashes |
| Data fetching | TanStack Query through `services/*` (the single client API surface) |
| UI | Tailwind CSS + shadcn/ui — the original design, unchanged |
| Payments | Paystack behind `lib/payments/provider.ts` (simulated locally) |
| Tests | Vitest (unit/integration) + shell end-to-end suites in `e2e/` |

No Redis and no external queue: rate limits and one-off jobs live in MongoDB.

---

## Quick start

```bash
# 1. MongoDB on localhost:27017 (any instance; point MONGODB_URI at it)
# 2. Environment
cp .env.example .env          # then set JWT_SECRET to a long random string

# 3. Dependencies + demo data
npm install
npm run seed                  # fresh database → full demo tenant + school

# 4. Develop
npm run dev                   # http://localhost:3000
```

Production-style run:

```bash
npm run build
npm run start -- --port 3100
```

### Demo sign-in

Password for every seeded account: **`password123`**

| Account | Role |
| --- | --- |
| `ada@greenfield.edu.ng` | Proprietor (owner of Greenfield Academy) |
| `grace@greenfield.edu.ng` | Administrator |
| `teacher1@greenfield.edu.ng` | Teacher (Mathematics) |
| `student1@greenfield.edu.ng` / `GFA-2401` | Learner — Chidinma Okeke |
| `student2@greenfield.edu.ng` / `GFA-2402` | Learner — Emeka Nwosu |
| `student3@greenfield.edu.ng` / `GFA-2403` | Learner — Aisha Bello |

Learners sign in with either their email or their admission number.

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` / `npm run start` | Production build / server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run seed` | Idempotent seed — see below |
| `npm run db:indexes` | Create/verify every declared index against the running MongoDB |
| `npm test` | Vitest suites |
| `npm run test:e2e` | Whole end-to-end gate (wipes the target database) |

### Seeding

```bash
npm run seed                        # empty database → full demo (classes,
                                    # learners, fees, attendance, exams, papers)
npm run seed -- --school <id>       # top up an existing school: classes,
                                    # subject, one teacher and the three learners
                                    # (never touches fees, attendance or exams)
npm run seed -- --full              # add the demo activity to an existing school
```

The script only ever inserts: every row is looked up first, so it is safe to
re-run after a partial failure. `--school` is what the e2e gate uses after
`e2e/auth.sh` has registered a school through the public API.

---

## Testing

### Unit + integration (Vitest)

```bash
npm test
```

Suites live in `tests/` and cover the rules that must not regress:

| File | Covers |
| --- | --- |
| `tests/tenant-isolation.test.ts` | Session-scoped school resolution, `scopedFilter`, cross-tenant reads, role gates |
| `tests/exam-window.test.ts` | Status over the window, `canStart`, deadline = min(start + duration, end), expiry boundary |
| `tests/mcq-grading.test.ts` | MCQ auto-grading, pending answers, subdocument-safe answer copies |
| `tests/paystack-webhook.test.ts` | HMAC-SHA512 webhook signature: valid, wrong key, tampered body, unsigned |
| `tests/error-logging.test.ts` | Error envelope, redaction of hashes/tokens, no stack traces in production |

They run against their own database (`mongodb://127.0.0.1:27017/campusflow-test`,
override with `TEST_MONGODB_URI`); the helper refuses any name that does not
look like a test database.

### End-to-end gate

Requires a **running server** (see Quick start) and the same local MongoDB:

```bash
npm run test:e2e        # wipes the database, re-registers, seeds, runs every suite
E2E_KEEP=1 npm run test:e2e   # keep the current database (must be fresh)
```

`e2e/run.sh` empties every collection (indexes are kept, so unique constraints
stay enforced while the server is up) and then rebuilds the data through the
public API. The suites, in order:

| Suite | Proves |
| --- | --- |
| `e2e-auth.sh` | Registration, sign-in for staff and learners, session cookie, rate limits |
| `e2e-roles.sh` | Role guards, learner vs staff surfaces, school switching, tenant C isolation |
| `e2e-resources.sh` | Classes, subjects, learners, staff, attendance, assignments + pagination/search/Zod |
| `e2e-fees.sh` | Invoices, simulated Paystack checkout, settlement, webhook |
| `e2e-exams.sh` | Authoring, answer-key exposure rules, autosave, tab-switch, deadline, grading, results, isolation |

Each suite is standalone (it signs its own sessions) and prints `ok`/`FAIL`
lines; the gate exits non-zero if anything failed. Override the target with
`E2E_BASE` (default `http://127.0.0.1:3100`) and the scratch directory with
`E2E_TMP` (default `<repo>/.e2e`, which holds session cookie jars).

---

## Architecture

### App Router layout

```
app/
  (auth)/          auth + onboarding screens
  (dashboard)/     staff screens: dashboard, classes, students, staff,
                   attendance, fees, exams, exam-builder, grading, results, settings
  (exam)/          learner exam runner
  api/             route handlers — one folder per resource
middleware.ts      session cookie gate before rendering
components/pages/  one client view per screen (thin server pages render these)
services/          the single client API surface + shared types
lib/               server code: db, auth, tenant, models, exams, serialize…
```

Route groups only organise folders — the visual design, copy and layout are the
ones the product already had.

### API contract

Every handler returns the same envelope:

```jsonc
{ "success": true, "data": { … }, "error": null }
{ "success": false, "data": null, "error": "Choose a class" }
```

* Bodies and query strings are parsed with Zod; the first issue becomes a
  readable `400`.
* Lists are paginated (`page`, `limit`, `q`, plus resource filters) and return
  `{ items, total, page, pageSize }`.
* `apiHandler` in `lib/api.ts` is the single error boundary: known `ApiError`s
  keep their status and message, everything else becomes a generic `500` with
  one redacted log line (no stack traces, no password hashes in production).

### Authentication

* Staff (`User`) sign in with email + password; learners (`Student`) with email
  **or** admission number (their `passwordHash` is `select: false`).
* The session is a signed JWT in an `httpOnly`, `sameSite=lax` cookie
  (`cf_session`), verified with `jose` in `lib/session-token.ts`.
* `requireAuth` (401/403) always runs before tenant resolution.

### Tenancy

`withTenant(req, { roles })` in `lib/tenant.ts` is the **only** way a handler
learns which tenant/school it is working with: the school id comes from the
signed session, is re-validated against the database on every request (a stale
or foreign id is corrected, never trusted), and handlers scope every query with
`scopedFilter(ctx)`. Nothing from a body, query string or header is ever used
for scoping.

### Data model

`Tenant → School → { User, Student, Class, Subject, TeacherAssignment,
Attendance, Invoice, Payment, Exam, Question, ExamAttempt }` — all with
timestamps, all tenant/school scoped, unique constraints on admission numbers,
class and subject names, invoice numbers, payment references, and one attempt
per learner per exam. `npm run db:indexes` prints the full index map; the
connection builds declared indexes before the first request is served, so a
unique guarantee can never be raced by an early write.

### CBT rules

* Window: `effectiveStatus` derives scheduled/live/closed from the stored
  status plus start/end times (the window is half-open: closed at the end
  instant).
* `deadlineAt = min(startedAt + durationMinutes, exam.endTime)`, computed once
  at start and enforced on every write; expired sittings are finalised lazily on
  read/write (no background worker).
* The learner payload never contains `correctOptionId` or `acceptedAnswer` —
  only the authoring (staff) endpoints return the key.
* Answers autosave through `PATCH /api/attempts/:id/answer`, tab switches are
  counted, submission auto-grades MCQs and queues short answers for hand
  grading; unanswered questions count towards `maxScore`.

### Payments

`lib/payments/provider.ts` hides the gateway: with `PAYSTACK_SECRET_KEY`
unset the app uses a simulated provider so the whole fees flow works offline.
Webhooks are the one session-less route — trust comes only from the
`x-paystack-signature` HMAC-SHA512 over the raw body; unsigned pushes are
rejected with `401`, unknown or duplicate references are acknowledged without
side effects, and an amount mismatch settles nothing.

### Rate limiting

Fixed windows stored in MongoDB with a TTL index on `expiresAt` — login is
limited per identity, registration per IP. Fail-open: a database hiccup never
locks customers out.

### Storage

School logos go through `lib/storage.ts` (MIME allowlist, 1 MB limit) into
`public/uploads/schools/` with a content-derived filename; the stored URL is
exposed as `logoUrl` only when it is a remote/app URL, never a `javascript:`
string.

---

## Configuration

`.env.example` — copy to `.env`:

```
MONGODB_URI=mongodb://127.0.0.1:27017/campusflow
JWT_SECRET=<openssl rand -base64 48>
JWT_EXPIRES_IN=7d
PAYSTACK_SECRET_KEY=            # empty → simulated checkout
PAYSTACK_PUBLIC_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000
```
# School-manager
