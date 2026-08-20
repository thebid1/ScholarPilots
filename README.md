# ScholarPilot

<p align="center">
  <strong>An AI scholarship copilot that finds funding, tracks your applications, and reminds you before deadlines close.</strong>
</p>

<p align="center">
  <a href="#-features">Features</a> •
  <a href="#-architecture">Architecture</a> •
  <a href="#-getting-started">Getting Started</a> •
  <a href="#-deployment">Deployment</a> •
  <a href="#-security">Security</a>
</p>

---

## 📖 Overview

Scholarship information is scattered across university pages, funder sites, and PDFs, and the deadlines are the part that actually costs students money — miss one and the opportunity is gone for a year.

ScholarPilot pulls a curated catalog into one place, lets a student track what they are applying for, and pushes a web notification before each deadline. An AI copilot answers questions about specific awards: what it pays, which eligibility criteria the student already meets, which they do not, and what is worth strengthening before applying.

**It does not score, rank, or match students to scholarships.** Discover shows what is open and lets the student sort and filter it themselves. The copilot lays out what an award requires and where the student stands, but it will not tell them their odds or pick a "best fit" — that judgement stays with the applicant.

---

## ✨ Features

### Discover
- Browse a catalog of **verified international scholarships** across **multiple countries**.
- Search by title, funder, or country; filter by country.
- Sort by **due soonest**, **due latest**, or **tracking first**.
- Only future-dated opportunities are served — closed cycles are filtered out in SQL.
- The catalog is refreshed daily from configured official university, funder, foundation, and government scholarship pages.
- Each card shows the award amount, deadline countdown, degree level, eligibility, and required documents.
- **Ask AI** on any card opens a dedicated chat thread about that specific opportunity.

### Pipeline
- Track any opportunity to your personal pipeline, stored per-user in Firestore.
- Auto-generated milestones: Draft SOP, Request Recommendations, Finalise Documents, Submit.
- Status flow: Discovered → Tailoring → Documents Ready → Submitted.
- A health score derived from completed milestones, plus deadline countdowns.
- Each application stores a **denormalized snapshot** of the opportunity, so a tracked application keeps its title and deadline even if the catalog entry changes.

### Chat
- Multi-thread conversations, each persisted to Firestore and synced across devices.
- Threads opened from Discover are pinned to one opportunity and keep that context for the whole conversation.
- The copilot sees your profile, your tracked pipeline, and the opportunities open to you — so "what are my deadlines?" and "what could I still apply for?" are answered from two distinct lists, never conflated.
- Compound questions get compound answers. There is no keyword router deciding what you meant.

### Add your own opportunities
- Paste the text of any funding page and the AI structures it into an editable draft.
- **Search by name** looks a scholarship up on the web and drafts it from the results.
- Fields the model was unsure about are flagged, and nothing saves until you confirm it. The deadline is a required date input, never free text — in a deadline-tracking app, a hallucinated date is the one error that actually costs the user something.
- Saved opportunities appear in Discover with an "Added by you" badge and are trackable like any catalog entry.

### Deadline notifications
- Opt-in web push via Firebase Cloud Messaging.
- A daily Render cron job sweeps every tracked application and sends reminders at 7 days and 1 day out.
- Every send is recorded on the application, so the daily job cannot repeat a reminder it already delivered.

### Reviewed scholarship ingestion
- A daily Render cron reads the listing sites in `FIRECRAWL_LISTING_URLS` for leads, then traces each lead to the funder's own page. Listing sites are discovery inputs only — none of them can ever be stored as a scholarship's source.
- Featherless verifies each official page before anything is filed: it must be the funder's own page, actually describe a scholarship, and match the lead's title.
- Nothing the pipeline finds reaches students automatically. Every result is filed as a submission for review at `/admin`, and an admin approving it is what writes the catalog row. Proposed changes and retirements of existing rows go through the same queue.
- Gaps are handed to the reviewer rather than dropped: a page with no printed deadline arrives flagged `no-deadline`, and a lead whose official link could not be confirmed arrives flagged `no-source-url` with every link the resolver considered attached. Both are finished by hand — the pipeline never guesses a link or a date.
- Firecrawl credits are a fixed lifetime pool tracked in `ingestion_runs`, and a run refuses to start once it is gone. Manual runs are capped separately and cannot start while another run is in flight.
- Duplicates are blocked by a unique deterministic identity made from the normalized scholarship title and funder (falling back to the official owner domain when the funder is unknown). Canonical URL matching and conservative title similarity merge changed page URLs, multiple official sources, and minor title/year variations into the existing row.
- A separate weekly cron deletes past-deadline catalog rows. Tracked applications remain usable because they keep a denormalized opportunity snapshot in Firestore.

### PWA
- Installable to the home screen, with a service worker caching static assets and navigation.
- Mobile-first layout with a bottom tab bar; desktop gets a sidebar.



---

## 🏗️ Architecture

```
                    ┌──────────────────────────────────┐
                    │   Render Web Service (Node)      │
                    │   Next.js 14 App Router          │
                    │   React 18 · TS · Tailwind       │
                    └───────┬──────────────────┬───────┘
                            │                  │
              ┌─────────────┘                  └──────────────┐
              ▼                                               ▼
   ┌────────────────────────┐                    ┌─────────────────────────┐
   │   Render Postgres      │                    │        Firebase         │
   │  ────────────────────  │                    │  ─────────────────────  │
   │  scholarships (46)     │                    │  Auth    → identity     │
   │  filter_cache (12h)    │                    │  Firestore → user data  │
   │  cron writes catalog  │                    │  FCM     → web push     │
   └────────────────────────┘                    └─────────────────────────┘
              ▲                                               ▲
              │                                               │
   ┌──────────┴───────────┐                     ┌─────────────┴───────────┐
    │   Featherless AI     │                     │  Render Cron (daily)    │
   │   Qwen models        │                     │  → /api/cron/           │
    │    filter · extract   │                     │    check-deadlines      │
    │    verify catalog     │                     │    ingest · cleanup     │
   └──────────────────────┘                     └─────────────────────────┘
```

### Why the data is split

**Postgres holds the shared catalog.** It is curated, identical for every user, and queried with SQL — `deadline >= CURRENT_DATE`, GIN indexes on degree levels and fields of study. Nothing user-owned lives here.

**Firestore holds everything owned by one user** — profile, applications, chat threads, self-added opportunities, and FCM tokens. Security rules scope every document to its owner's `uid`, so a user's data is unreachable by anyone else.

The cron job reads Firestore only. That is why each application carries a `snapshot` of its opportunity: the sweep needs a title and a date without joining from Firestore back into Postgres.

### AI

Every AI call goes to **Featherless AI** over its OpenAI-compatible endpoint. One provider, four jobs:

| Job | Model | Why |
|---|---|---|
| Discipline filter | `Qwen/Qwen2.5-72B-Instruct` | Decides which catalog entries suit a student's field. Results cached in Postgres for 12h. |
| Chat | `Qwen/Qwen3-30B-A3B-Instruct-2507` | ~13s per turn, against ~16s for Kimi-K2 and ~38s for Qwen2.5-72B. Reasoning models answered well but took 49–79s — too long behind a typing indicator. |
| Pasted-listing parser | `Qwen/Qwen2.5-72B-Instruct` | Structures pasted page text into a scholarship draft. |
| Search-by-name extraction | `Qwen/Qwen2.5-72B-Instruct` | Turns Brave web results into a draft. |

The filter cache lives in Postgres rather than memory: Render restarts and redeploys would empty an in-process cache, and a 12h TTL would never be reached.

### Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Icons | Lucide React |
| Catalog DB | Render Postgres (`pg`) |
| User data | Firebase Firestore |
| Auth | Firebase Auth (email/password) |
| Push | Firebase Cloud Messaging + `firebase-admin` |
| AI | Featherless AI (Qwen) |
| Web search | Brave Search API |
| Hosting | Render (web service + scheduled cron jobs) |

### API routes

| Route | Purpose |
|---|---|
| `POST /api/opportunities` | Catalog for a profile — future deadlines, discipline-filtered, cached. |
| `GET /api/scholarships` | Raw catalog, future deadlines only. |
| `POST /api/opportunities/parse` | Pasted text → structured scholarship draft. |
| `POST /api/opportunities/search` | Scholarship name → web search → draft. |
| `POST /api/chat` | Conversational turn, with profile, pipeline, catalog, and optional focused opportunity. |
| `GET /api/cron/check-deadlines` | Daily reminder sweep. Requires `Authorization: Bearer $CRON_SECRET`. |
| `GET /api/cron/ingest-scholarships` | Daily discovery run. Files what it finds for review; writes nothing to the catalog. Requires `Authorization: Bearer $CRON_SECRET`. |
| `GET /api/cron/cleanup-scholarships` | Weekly deletion of expired catalog rows. Requires `Authorization: Bearer $CRON_SECRET`. |
| `GET /api/admin/submissions` | Review queue plus counts. Admin only. |
| `PATCH /api/admin/submissions/[id]` | Approve (with edits) or reject one submission. Approving is the only write to the catalog. Admin only. |
| `GET /api/admin/ingest` | What a run would do, and what it would cost. Free. Admin only. |
| `POST /api/admin/ingest` | Run ingestion now, with an optional `maxCredits` cap. Admin only. |

Admin routes authenticate with the caller's Firebase ID token (`Authorization: Bearer <idToken>`)
and require the account's verified email to appear in `ADMIN_EMAILS`. With `ADMIN_EMAILS` unset
they answer `503`, never `200` — an empty allowlist means nobody, not everybody.

### How a scholarship reaches the catalog

```
listing sites → funder's own page → Qwen extraction → /admin review → approval → Postgres
     Firecrawl        resolver          verification       flags/edits     the only write
```

Nothing scraped is published automatically. The daily run discovers leads on listing sites,
traces each one to the page hosted by the university, funder, or government that owns the award,
reads the details off *that* page, and files a submission. A listing site can never become a
scholarship's `source_url` — the rule is re-applied at approval, so it holds even for a link an
admin types in by hand.

Two gaps that used to cause silent drops now arrive flagged instead: a page with no printed
deadline, and an award whose official link could not be confirmed. Both are filed with the field
left empty and every link the resolver considered attached, for a reviewer to finish at `/admin`.
Changes to rows already in the catalog, and proposals to retire rows whose pages no longer verify,
go through the same queue with an old-vs-new diff.

### Project structure

```
.
├── app/
│   ├── admin/page.tsx           # Review queue — not linked from anywhere
│   ├── api/
│   │   ├── admin/ingest/route.ts
│   │   ├── admin/submissions/route.ts
│   │   ├── admin/submissions/[id]/route.ts
│   │   ├── chat/route.ts
│   │   ├── cron/check-deadlines/route.ts
│   │   ├── cron/cleanup-scholarships/route.ts
│   │   ├── cron/ingest-scholarships/route.ts
│   │   ├── opportunities/route.ts
│   │   ├── opportunities/parse/route.ts
│   │   ├── opportunities/search/route.ts
│   │   └── scholarships/route.ts
│   ├── components/              # Screens, cards, modals, chat UI
│   ├── hooks/
│   │   ├── useAdminApi.ts       # Authenticated fetch for the admin routes
│   │   ├── useApplications.ts   # Firestore pipeline
│   │   ├── useChatThreads.ts    # Firestore chat threads
│   │   ├── useNotifications.ts  # FCM permission + token
│   │   ├── useProfile.ts
│   │   └── useUserOpportunities.ts
│   ├── lib/
│   │   ├── featherless-filter.ts  # Discipline filter + Postgres cache
│   │   ├── user-store.ts          # All Firestore reads/writes
│   │   ├── web-search.ts          # Brave Search
│   │   ├── mockData.ts            # Milestones, health score, date helpers
│   │   └── scholarships.json      # Seed source for the catalog
│   ├── providers/AuthProvider.tsx
│   ├── types/index.ts
│   └── {,opportunities,applications,chat,profile}/page.tsx
├── lib/
│   ├── db.ts                    # Postgres pool
│   ├── admin/auth.ts            # ADMIN_EMAILS gate over Firebase ID tokens
│   ├── ingestion/               # Discovery → resolution → verification → review
│   │   ├── index.ts             # The run itself
│   │   ├── budget.ts            # Firecrawl credit ledger
│   │   ├── candidates.ts        # Durable lead queue with backoff
│   │   ├── discovery.ts         # Listing pages and Brave queries
│   │   ├── fetch.ts             # Free HTTP first, Firecrawl when needed
│   │   ├── resolve.ts           # Listing article → funder's own page
│   │   ├── sources.ts           # Aggregator blocklist and source gate
│   │   ├── store.ts             # Catalog upserts, applied on approval
│   │   ├── submissions.ts       # Review queue: file, approve, reject
│   │   └── verify.ts            # Qwen extraction off the official page
│   └── firebase/{client,admin}.ts
├── public/
│   ├── firebase-messaging-sw.js # FCM background handler
│   ├── sw.js                    # Offline cache worker
│   └── manifest.json
├── scripts/                     # Seeding, schema, sync, e2e helpers
├── firestore.rules
├── render.yaml                  # Render Blueprint (web + cron)
└── schema.sql
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 20+
- A Postgres database (Render Postgres, or local)
- A Firebase project with **Auth**, **Firestore**, and **Cloud Messaging** enabled
- A [Featherless AI](https://featherless.ai) API key
- A [Firecrawl](https://www.firecrawl.dev/) API key
- A [Brave Search](https://brave.com/search/api/) API key (free tier: 2,000 queries/month)

### 1. Install

```bash
npm install
```

### 2. Configure

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

```env
DATABASE_URL=postgresql://user:password@host/dbname
FEATHERLESS_API_KEY=
BRAVE_SEARCH_API_KEY=

# Ingestion. Listing sites are where leads are discovered — anything listed here
# can never be stored as a scholarship's source. Values can be comma-, semicolon-,
# or newline-separated. See .env.example for the optional tuning knobs.
FIRECRAWL_API_KEY=
FIRECRAWL_BASE_URL=https://api.firecrawl.dev/v2
FIRECRAWL_LISTING_URLS=https://www.opportunitiesforafricans.com/category/scholarships/
FIRECRAWL_LIFETIME_CREDIT_BUDGET=10000
FIRECRAWL_RUN_CREDIT_BUDGET=28
FIRECRAWL_CONCURRENCY=1
FIRECRAWL_REQUEST_TIMEOUT_MS=120000
FEATHERLESS_EXTRACTION_MODEL=Qwen/Qwen2.5-72B-Instruct

# Who may approve scraped scholarships at /admin. Server-only; unset means nobody.
ADMIN_EMAILS=you@example.com

# Firebase browser SDK — public by design; Firestore rules protect the data.
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FIREBASE_VAPID_KEY=

# Server-only. Single-line JSON. Bypasses Firestore rules — never NEXT_PUBLIC_.
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}

CRON_SECRET=
```

`NEXT_PUBLIC_FIREBASE_VAPID_KEY` comes from *Project settings → Cloud Messaging → Web Push certificates*. `FIREBASE_SERVICE_ACCOUNT_JSON` comes from *Project settings → Service accounts → Generate new private key*, flattened to a single line.

### 3. Set up the database

```bash
npm run db:schema   # create tables and indexes
npm run seed        # load the 46-scholarship catalog
```

### 4. Deploy Firestore rules

```bash
firebase deploy --only firestore:rules
```

Without this, Firestore runs on its default rules and user data is not protected.

### 5. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), sign up, and complete the profile form.

---

## 🧪 Build & Test

```bash
npm run lint    # ESLint
npm run build   # Production build
npm start       # Serve the build
```

Both `lint` and `build` must pass before pushing.

> `next build` and `next dev` share the `.next` directory. Stop the dev server before building, or the running server will start throwing missing-chunk errors.

---

## 🚢 Deployment

The app deploys to **Render** from [`render.yaml`](render.yaml) as a Blueprint — a web service plus three scheduled cron jobs. It runs as a Node service, not a static site: the API routes need a server at runtime.

1. **Push and create the Blueprint.** Render reads `render.yaml` and provisions the web service plus the deadline, ingestion, and cleanup cron services. Every secret is declared `sync: false`, so Render prompts for the values in the dashboard rather than reading them from git.

2. **Fill in the web service's environment variables** — the same set as `.env.local`. `CRON_SECRET` is generated automatically.

   Apply the latest Postgres schema with `npm run db:schema` before enabling ingestion. This adds crawl time, official source type, and unique identity fields to existing databases.

3. **Wire up the cron job.** Set `APP_URL` to the deployed web service URL (e.g. `https://scholarpilot.onrender.com`), and copy the generated `CRON_SECRET` from the web service across to the cron service. They must match or every run gets a 401.

   Set `FIRECRAWL_API_KEY` and `FIRECRAWL_SOURCE_URLS` on the web service. `FIRECRAWL_SOURCE_URLS` is a comma-, semicolon-, or newline-separated list of known official scholarship pages. Do not put directories, blogs, or search-result pages in this list.

   Keep `FIRECRAWL_CONCURRENCY=1` on low-concurrency plans. Each URL is scraped once and then sent to Featherless for verification and extraction. Increase concurrency only when the Firecrawl account has matching browser capacity.

4. **Deploy Firestore rules** (`firebase deploy --only firestore:rules`) — these are not part of the Render deploy.

5. **Add your Render domain to Firebase** under *Authentication → Settings → Authorized domains*, or sign-in will be rejected in production.

6. **Verify the cron endpoints:**

   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" \
     https://your-app.onrender.com/api/cron/check-deadlines
   ```

   Run it twice. The second run must report skips rather than sending again — that is the dedupe working. A request with no header must return 401.

   After Firecrawl configuration is present, verify ingestion with:

   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" \
     https://your-app.onrender.com/api/cron/ingest-scholarships
   ```

   The response reports crawled documents, AI-verified records, inserts, and updates. The cleanup endpoint reports how many past-deadline records were deleted.

Ingestion runs daily at `05:42 UTC`, deadline reminders at `06:12 UTC`, and expired-row cleanup every Sunday at `04:15 UTC`. Each schedule is deliberately off the hour to reduce queue contention.


---

## 🔒 Security

- **Firestore rules scope every document to its owner.** `users/{uid}/{document=**}` is readable and writable only when `request.auth.uid == uid`. Everything outside a user's own tree is denied, including client `collectionGroup` queries.
- **`FIREBASE_SERVICE_ACCOUNT_JSON` bypasses those rules by design** — it is what lets the cron job read across users. It is server-only and must never carry a `NEXT_PUBLIC_` prefix.
- **`NEXT_PUBLIC_FIREBASE_*` values ship in the browser bundle.** That is expected: Firebase client config is public, and the rules are what protect the data.
- **`.env.local` is gitignored** and must never be committed.
- **All `/api/cron/*` routes are guarded by a bearer token** and refuse to run at all if `CRON_SECRET` is unset.
- Automated catalog records are saved only after Featherless verifies the scraped official page and returns its source type, title, and exact open deadline. The accepted `university`, `funder`, or `government` classification is retained in Postgres for auditing.

---

## 🔮 Future work

- **Recurring deadlines.** 
- **Wider catalog coverage.** 
- **Richer notification windows.** 
- **School website integration for seamless application and tracking**

---

## 📄 License

MIT
