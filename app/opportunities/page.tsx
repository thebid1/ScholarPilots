'use client';

import { useEffect, useMemo, useState } from 'react';
import { Scholarship } from '@/app/types';
import SignInScreen from '@/app/components/SignInScreen';
import ProfileForm from '@/app/components/ProfileForm';
import Sidebar from '@/app/components/Sidebar';
import OpportunitiesScreen from '@/app/components/OpportunitiesScreen';
import SplashScreen from '@/app/components/SplashScreen';
import { useAuth } from '@/app/providers/AuthProvider';
import { useProfile } from '@/app/hooks/useProfile';
import { useApplications } from '@/app/hooks/useApplications';
import { useUserOpportunities } from '@/app/hooks/useUserOpportunities';

export default function OpportunitiesPage() {
  const { user, loading: authLoading } = useAuth();
  const { profile, loading: profileLoading, save } = useProfile();
  const { applications, track } = useApplications();
  const {
    opportunities: userOpportunities,
    loading: userOpportunitiesLoading,
    error: userOpportunitiesError,
    add: addOpportunity,
    remove: removeOpportunity,
  } = useUserOpportunities();

  const [scholarships, setScholarships] = useState<Scholarship[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;

    let cancelled = false;
    async function fetchScholarships() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/opportunities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to fetch scholarships');
        if (!cancelled) setScholarships(data.scholarships || []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load scholarships');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchScholarships();
    return () => {
      cancelled = true;
    };
  }, [profile]);

  // The user's own entries sit above the catalog — they added them on purpose,
  // so they should not have to scroll past 40 curated rows to find them.
  const merged = useMemo(
    () => [...userOpportunities, ...scholarships],
    [userOpportunities, scholarships]
  );
  const userAddedIds = useMemo(
    () => new Set(userOpportunities.map((o) => o.id)),
    [userOpportunities]
  );

  if (authLoading || (user && profileLoading)) {
    return <SplashScreen />;
  }

  if (!user) {
    return <SignInScreen />;
  }

  if (!profile) {
    return <ProfileForm onComplete={save} />;
  }

  return (
    <div className="min-h-[100dvh] flex flex-col md:flex-row page-bg pb-20 md:pb-0">
      <Sidebar />
      <main className="flex-1 min-w-0 px-4 py-4 md:px-8 md:py-8">
        <div className="max-w-3xl mx-auto">
          <OpportunitiesScreen
            applications={applications}
            scholarships={merged}
            loading={loading || userOpportunitiesLoading}
            error={error || userOpportunitiesError}
            onTrack={track}
            userAddedIds={userAddedIds}
            onAddOpportunity={addOpportunity}
            onRemoveOpportunity={removeOpportunity}
          />
        </div>
      </main>
    </div>
  );
}
