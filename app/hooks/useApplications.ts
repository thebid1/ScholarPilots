'use client';

import { useCallback, useEffect, useState } from 'react';
import { Application, Scholarship } from '@/app/types';
import { createApplication } from '@/app/lib/mockData';
import {
  addApplication,
  deleteApplication,
  updateApplication,
  watchApplications,
} from '@/app/lib/user-store';
import { useAuth } from '@/app/providers/AuthProvider';

/**
 * The signed-in user's tracked applications, live from Firestore.
 *
 * A live subscription rather than a one-shot read: the cron job writes
 * `notified` flags server-side, and the same account may be open on a phone and
 * a laptop during a demo.
 */
export function useApplications() {
  const { user, loading: authLoading } = useAuth();
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setApplications([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsubscribe = watchApplications(
      user.uid,
      (apps) => {
        setApplications(apps);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
    return unsubscribe;
  }, [user, authLoading]);

  const track = useCallback(
    async (scholarship: Scholarship, source: 'catalog' | 'user' = 'catalog') => {
      if (!user) return;
      // Tracking the same opportunity twice is a no-op, not a duplicate row.
      const already = applications.some(
        (a) => a.scholarshipId === scholarship.id || a.snapshot.title === scholarship.title
      );
      if (already) return;
      try {
        await addApplication(user.uid, createApplication(scholarship, source));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to track opportunity');
      }
    },
    [user, applications]
  );

  const update = useCallback(
    async (id: string, patch: Partial<Omit<Application, 'id'>>) => {
      if (!user) return;
      try {
        await updateApplication(user.uid, id, patch);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update application');
      }
    },
    [user]
  );

  const remove = useCallback(
    async (id: string) => {
      if (!user) return;
      try {
        await deleteApplication(user.uid, id);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to remove application');
      }
    },
    [user]
  );

  return { applications, loading, error, track, update, remove };
}
