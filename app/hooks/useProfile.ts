'use client';

import { useCallback, useEffect, useState } from 'react';
import { UserProfile } from '@/app/types';
import { fetchProfile, saveProfile as persistProfile } from '@/app/lib/user-store';
import { useAuth } from '@/app/providers/AuthProvider';

/**
 * The signed-in user's profile, read from `users/{uid}.profile`.
 *
 * `loading` stays true until the first read settles so callers don't flash the
 * profile form at a user who already has one.
 */
export function useProfile() {
  const { user, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetchProfile(user.uid)
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load profile');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  const save = useCallback(
    async (next: UserProfile) => {
      if (!user) return;
      // Optimistic: the gate in every page keys off profile presence, so waiting
      // on the round trip would leave the form on screen after a valid submit.
      setProfile(next);
      try {
        await persistProfile(user.uid, next);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save profile');
      }
    },
    [user]
  );

  return { profile, loading: authLoading || loading, error, save };
}
