CREATE TABLE IF NOT EXISTS scholarships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  funder TEXT,
  country TEXT,
  amount_currency TEXT DEFAULT 'USD',
  amount_value NUMERIC,
  amount_type TEXT CHECK (amount_type IN ('full', 'partial', 'stipend', 'unknown')),
  deadline DATE,
  degree_levels TEXT[] NOT NULL DEFAULT '{}',
  fields_of_study TEXT[] NOT NULL DEFAULT '{}',
  eligible_nationalities TEXT[] NOT NULL DEFAULT '{}',
  min_gpa NUMERIC,
  requirements TEXT,
  eligibility TEXT[] DEFAULT '{}',
  description TEXT,
  source_url TEXT,
  required_docs TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  verified_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Postgres holds only the shared, curated scholarship catalog. Everything
-- user-owned (profile, applications, FCM tokens, user-added opportunities)
-- lives in Firestore under users/{uid} — see firestore.rules.

-- Discipline-filter results, cached so a repeat visit to Discover does not pay
-- for another LLM call. Keyed on every profile field the prompt interpolates,
-- so a profile edit misses the cache rather than serving a stale answer.
-- Postgres rather than memory: Render restarts and redeploys would otherwise
-- empty an in-process cache and the 12h TTL would never be reached.
CREATE TABLE IF NOT EXISTS filter_cache (
  cache_key TEXT PRIMARY KEY,
  scholarship_ids TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_filter_cache_created ON filter_cache(created_at);

CREATE INDEX IF NOT EXISTS idx_scholarships_degrees ON scholarships USING GIN(degree_levels);
CREATE INDEX IF NOT EXISTS idx_scholarships_fields ON scholarships USING GIN(fields_of_study);
CREATE INDEX IF NOT EXISTS idx_scholarships_nations ON scholarships USING GIN(eligible_nationalities);
CREATE INDEX IF NOT EXISTS idx_scholarships_active ON scholarships(is_active, deadline);

-- Audit fields for the automated Firecrawl/AI catalog refresh. `identity_key`
-- is also the marker that separates pipeline-created rows from the hand-seeded
-- catalog: ingestion only ever re-crawls or deactivates rows where it is set.
ALTER TABLE scholarships ADD COLUMN IF NOT EXISTS last_crawled_at TIMESTAMPTZ;
ALTER TABLE scholarships ADD COLUMN IF NOT EXISTS identity_key TEXT;
ALTER TABLE scholarships ADD COLUMN IF NOT EXISTS source_type TEXT
  CHECK (source_type IN ('university', 'funder', 'government'));
CREATE UNIQUE INDEX IF NOT EXISTS idx_scholarships_identity_key
  ON scholarships(identity_key) WHERE identity_key IS NOT NULL;

-- What the award pays for, as distinct from what the applicant must submit.
-- Extraction kept filing tuition/stipend/airfare into required_docs for want of
-- anywhere else to put it; giving it a column of its own is what stops that.
ALTER TABLE scholarships ADD COLUMN IF NOT EXISTS benefits TEXT[] DEFAULT '{}';

-- One row per ingestion run. This table IS the Firecrawl budget enforcement:
-- the allowance is a fixed lifetime pool, so spend has to survive restarts and
-- redeploys. Credits are reserved before any scraping starts and reconciled to
-- the real figure at the end, which means a run that dies mid-flight still
-- counts against the pool rather than silently handing it back.
CREATE TABLE IF NOT EXISTS ingestion_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  credits_reserved INTEGER NOT NULL DEFAULT 0,
  credits_spent INTEGER NOT NULL DEFAULT 0,
  listings INTEGER NOT NULL DEFAULT 0,
  candidates INTEGER NOT NULL DEFAULT 0,
  resolved INTEGER NOT NULL DEFAULT 0,
  verified INTEGER NOT NULL DEFAULT 0,
  inserted INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  refreshed INTEGER NOT NULL DEFAULT 0,
  deactivated INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'deadline', 'failed')),
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_started ON ingestion_runs(started_at DESC);

-- A run no longer writes to `scholarships` at all — it files submissions for
-- review. `inserted` and `updated` therefore stop being written; they are kept
-- rather than dropped so historical rows still read correctly.
ALTER TABLE ingestion_runs ADD COLUMN IF NOT EXISTS submitted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingestion_runs ADD COLUMN IF NOT EXISTS flagged INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingestion_runs ADD COLUMN IF NOT EXISTS retired INTEGER NOT NULL DEFAULT 0;

-- Scholarships discovered on a listing site, before they are good enough for
-- the catalog. Two jobs in one table:
--   1. Dedupe — a listing article is scraped once, ever, however many times it
--      reappears on the category page.
--   2. Retry — a candidate that cannot be resolved to an official funder page
--      (no outbound link, bot wall, missing deadline) is kept and retried with
--      backoff instead of being rediscovered from scratch every morning.
-- Nothing here is user-visible. A candidate only reaches `scholarships` once it
-- has been verified on a page hosted by the funder itself.
CREATE TABLE IF NOT EXISTS ingestion_candidates (
  candidate_key TEXT PRIMARY KEY,
  listing_url TEXT NOT NULL,
  article_url TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  funder TEXT NOT NULL DEFAULT '',
  official_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'stored', 'rejected')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingestion_candidates_queue
  ON ingestion_candidates(status, last_attempt_at NULLS FIRST);

-- The review queue. Everything the pipeline extracts lands here first and waits
-- for a human; nothing reaches `scholarships` without an approval.
--
-- Three columns are deliberately nullable where the catalog requires a value,
-- because those absences are precisely what a reviewer is for:
--   * deadline    — the funder's page verified but printed no exact date. Dropping
--                   these silently cost us real, open awards.
--   * source_url  — the official link could not be confirmed. Better an empty
--                   field a human fills than a guess that turns out to be an
--                   aggregator.
--   * source_type — unknowable until the source URL is settled.
-- `approveSubmission` enforces all three before anything is written, so the
-- catalog's own invariants are unchanged.
CREATE TABLE IF NOT EXISTS scholarship_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 'new' proposes a row, 'refresh' proposes changes to one, 'retire' proposes
  -- hiding one whose page no longer verifies.
  kind TEXT NOT NULL DEFAULT 'new' CHECK (kind IN ('new', 'refresh', 'retire')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),

  identity_key TEXT NOT NULL,
  candidate_key TEXT,
  article_url TEXT,
  -- The `scholarships` row this targets (refresh/retire) or created (new).
  external_id TEXT,

  source_type TEXT CHECK (source_type IN ('university', 'funder', 'government')),
  title TEXT NOT NULL,
  funder TEXT,
  country TEXT,
  amount_currency TEXT,
  amount_value NUMERIC,
  amount_type TEXT CHECK (amount_type IN ('full', 'partial', 'stipend', 'unknown')),
  deadline DATE,
  degree_levels TEXT[] NOT NULL DEFAULT '{}',
  fields_of_study TEXT[] NOT NULL DEFAULT '{}',
  eligible_nationalities TEXT[] NOT NULL DEFAULT '{}',
  min_gpa NUMERIC,
  requirements TEXT,
  eligibility TEXT[] NOT NULL DEFAULT '{}',
  description TEXT,
  source_url TEXT,
  required_docs TEXT[] NOT NULL DEFAULT '{}',
  benefits TEXT[] NOT NULL DEFAULT '{}',

  -- 'no-deadline', 'no-source-url', 'no-source-type', 'source-unverified': what
  -- the reviewer must resolve. An empty array means the extraction was complete
  -- on its own. Left unconstrained on purpose — a new kind of gap should not need
  -- a migration before it can be reported.
  flags TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  -- The current values of the targeted row, so a refresh can be shown as a diff.
  previous JSONB,
  -- The resolver's shortlist, which link it picked, and the gate's objection.
  -- This is what makes filling in a missing source URL a ten-second job.
  candidate_links JSONB,
  -- The model's unmodified reply, for diagnosing a bad extraction.
  raw_extraction JSONB,

  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One pending submission per award, ever. Partial so that a rejected or approved
-- submission does not block the same award being proposed again later.
CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_pending_identity
  ON scholarship_submissions(identity_key) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_submissions_queue
  ON scholarship_submissions(status, created_at DESC);
