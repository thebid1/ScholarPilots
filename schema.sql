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
