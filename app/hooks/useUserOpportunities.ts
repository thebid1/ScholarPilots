'use client';

import { useCallback, useEffect, useState } from 'react';
import { Scholarship, UserOpportunity } from '@/app/types';
import { addUserOpportunity, deleteUserOpportunity, fetchUserOpportunities } from '@/app/lib/user-store';
import { useAuth } from '@/app/providers/AuthProvider';

/** Opportunities the user added themselves, stored under users/{uid}/opportunities. */
export function useUserOpportunities() {
  const { user, loading: authLoading } = useAuth();
  const [opportunities, setOpportunities] = useState<UserOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!user) {
      setOpportunities([]);
      setLoading(false);
      return;
    }
    try {
      setOpportunities(await fetchUserOpportunities(user.uid));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load your opportunities');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    reload();
  }, [authLoading, reload]);

  const add = useCallback(
    async (opportunity: Omit<Scholarship, 'id'>) => {
      if (!user) return;
      await addUserOpportunity(user.uid, {
        ...opportunity,
        createdAt: new Date().toISOString(),
      });
      await reload();
    },
    [user, reload]
  );

  const remove = useCallback(
    async (id: string) => {
      if (!user) return;
      await deleteUserOpportunity(user.uid, id);
      await reload();
    },
    [user, reload]
  );

  return { opportunities, loading, error, add, remove };
}
