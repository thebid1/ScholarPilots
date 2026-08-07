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
- Browse a catalog of **46 verified international scholarships** across **23 countries**.
- Search by title, funder, or country; filter by country.
- Sort by **due soonest**, **due latest**, or **tracking first**.
- Only future-dated opportunities are served — closed cycles are filtered out in SQL.
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

### PWA
- Installable to the home screen, with a service worker caching static assets and navigation.
- Mobile-first layout with a bottom tab bar; desktop gets a sidebar.

> **Note on iOS:** web push requires the PWA to be installed to the home screen (iOS 16.4+). Desktop Chrome is the most reliable path for notifications.

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
   │  read-only at runtime  │                    │  FCM     → web push     │
   └────────────────────────┘                    └─────────────────────────┘
              ▲                                               ▲
              │                                               │
   ┌──────────┴───────────┐                     ┌─────────────┴───────────┐
   │   Featherless AI     │                     │  Render Cron (daily)    │
   │   Qwen models        │                     │  → /api/cron/           │
   │   chat · parse ·     │                     │    check-deadlines      │
   │   filter · extract   │                     │  → firebase-admin → FCM │
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
| Hosting | Render (web service + cron job) |

### API routes

| Route | Purpose |
|---|---|
| `POST /api/opportunities` | Catalog for a profile — future deadlines, discipline-filtered, cached. |
| `GET /api/scholarships` | Raw catalog, future deadlines only. |
| `POST /api/opportunities/parse` | Pasted text → structured scholarship draft. |
| `POST /api/opportunities/search` | Scholarship name → web search → draft. |
| `POST /api/chat` | Conversational turn, with profile, pipeline, catalog, and optional focused opportunity. |
| `GET /api/cron/check-deadlines` | Daily reminder sweep. Requires `Authorization: Bearer $CRON_SECRET`. |

### Project structure

```
.
├── app/
│   ├── api/
│   │   ├── chat/route.ts
│   │   ├── cron/check-deadlines/route.ts
│   │   ├── opportunities/route.ts
│   │   ├── opportunities/parse/route.ts
│   │   ├── opportunities/search/route.ts
│   │   └── scholarships/route.ts
│   ├── components/              # Screens, cards, modals, chat UI
│   ├── hooks/
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

The app deploys to **Render** from [`render.yaml`](render.yaml) as a Blueprint — a web service plus a daily cron job. It runs as a Node service, not a static site: the API routes need a server at runtime.

1. **Push and create the Blueprint.** Render reads `render.yaml` and provisions both services. Every secret is declared `sync: false`, so Render prompts for the values in the dashboard rather than reading them from git.

2. **Fill in the web service's environment variables** — the same set as `.env.local`. `CRON_SECRET` is generated automatically.

3. **Wire up the cron job.** Set `APP_URL` to the deployed web service URL (e.g. `https://scholarpilot.onrender.com`), and copy the generated `CRON_SECRET` from the web service across to the cron service. They must match or every run gets a 401.

4. **Deploy Firestore rules** (`firebase deploy --only firestore:rules`) — these are not part of the Render deploy.

5. **Add your Render domain to Firebase** under *Authentication → Settings → Authorized domains*, or sign-in will be rejected in production.

6. **Verify the cron endpoint:**

   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" \
     https://your-app.onrender.com/api/cron/check-deadlines
   ```

   Run it twice. The second run must report skips rather than sending again — that is the dedupe working. A request with no header must return 401.

The cron fires at `12 6 * * *` (06:12 UTC), deliberately off the hour so it isn't queued behind every blueprint scheduled at `:00`.

> **Free tier:** Render spins services down when idle, so the first request after a quiet period takes ~30s. Warm the app before a demo, and warm Discover too — the discipline filter's 12h cache is cold after a redeploy.

---

## 🔒 Security

- **Firestore rules scope every document to its owner.** `users/{uid}/{document=**}` is readable and writable only when `request.auth.uid == uid`. Everything outside a user's own tree is denied, including client `collectionGroup` queries.
- **`FIREBASE_SERVICE_ACCOUNT_JSON` bypasses those rules by design** — it is what lets the cron job read across users. It is server-only and must never carry a `NEXT_PUBLIC_` prefix.
- **`NEXT_PUBLIC_FIREBASE_*` values ship in the browser bundle.** That is expected: Firebase client config is public, and the rules are what protect the data.
- **`.env.local` is gitignored** and must never be committed.
- **`/api/cron/check-deadlines` is guarded by a bearer token** and refuses to run at all if `CRON_SECRET` is unset.
- AI-extracted opportunities are **never saved without user confirmation**.

---

## 🔮 Future work

- **Recurring deadlines.** Annual awards whose cycle has closed are currently rolled forward by hand. A `recurring` column on `scholarships` is the durable fix.
- **URL ingestion.** Today users paste page text. Server-side fetching hits bot walls, JS-rendered pages, and PDFs — worth doing, but not a small job.
- **Wider catalog coverage.** Some funders (DAAD among them) sit behind bot protection and need a different ingestion path.
- **Richer notification windows.** 7-day and 1-day reminders are hardcoded; per-user preferences would be better.

---

## 📄 License

MIT
