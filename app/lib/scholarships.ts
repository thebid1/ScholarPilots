import { useEffect, useState } from 'react';
import { Scholarship } from '@/app/types';

const STORAGE_INDEXER =
  process.env.NEXT_PUBLIC_OG_STORAGE_INDEXER || 'https://indexer-storage-testnet-turbo.0g.ai';
const ROOT_HASH = process.env.NEXT_PUBLIC_SCHOLARSHIP_ROOT_HASH;
const CACHE_KEY = 'scholarpilot_scholarships_cache';
const SOURCE_KEY = 'scholarpilot_scholarships_source';

interface LoadResult {
  scholarships: Scholarship[];
  source: '0g' | 'local';
  rootHash?: string;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function getCache(): { data: Scholarship[]; source: '0g' | 'local' } | null {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const source = localStorage.getItem(SOURCE_KEY) as '0g' | 'local' | null;
    if (raw && source) {
      return { data: JSON.parse(raw) as Scholarship[], source };
    }
  } catch {
    // ignore cache errors
  }
  return null;
}

function setCache(data: Scholarship[], source: '0g' | 'local'): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    localStorage.setItem(SOURCE_KEY, source);
  } catch {
    // ignore cache errors
  }
}

export async function fetchScholarshipsFrom0G(rootHash: string): Promise<Scholarship[]> {
  const url = `${STORAGE_INDEXER}/file?root=${encodeURIComponent(rootHash)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json, */*' },
  });

  if (!response.ok) {
    throw new Error(`0G Storage fetch failed: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  const data = JSON.parse(text) as Scholarship[];

  if (!Array.isArray(data)) {
    throw new Error('Invalid scholarship data format from 0G Storage');
  }

  return data;
}

export async function loadScholarships(): Promise<LoadResult> {
  // 1. Try 0G Storage if a root hash is configured.
  if (ROOT_HASH) {
    try {
      const data = await fetchScholarshipsFrom0G(ROOT_HASH);
      setCache(data, '0g');
      return { scholarships: data, source: '0g', rootHash: ROOT_HASH };
    } catch (err) {
      console.warn('Failed to load scholarships from 0G Storage, will try cache:', err);
    }
  }

  // 2. Try cached 0G data.
  const cache = getCache();
  if (cache?.source === '0g') {
    return { scholarships: cache.data, source: '0g', rootHash: ROOT_HASH };
  }

  // 3. No local mock data fallback — app relies on 0G Storage.
  throw new Error(
    ROOT_HASH
      ? 'Failed to load scholarships from 0G Storage and no cached data is available.'
      : 'NEXT_PUBLIC_SCHOLARSHIP_ROOT_HASH is not configured. Upload the catalog to 0G Storage first.'
  );
}


export interface UseScholarshipsResult {
  scholarships: Scholarship[];
  loading: boolean;
  error: string | null;
  source: '0g' | 'local' | null;
  rootHash?: string;
  retry: () => void;
}

export function useScholarships(): UseScholarshipsResult {
  const [scholarships, setScholarships] = useState<Scholarship[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<'0g' | 'local' | null>(null);
  const [rootHash, setRootHash] = useState<string | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);

      try {
        const result = await loadScholarships();
        if (!cancelled) {
          setScholarships(result.scholarships);
          setSource(result.source);
          setRootHash(result.rootHash);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load scholarships');
          setScholarships([]);
          setSource(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return {
    scholarships,
    loading,
    error,
    source,
    rootHash,
    retry: () => setAttempt((a) => a + 1),
  };
}
