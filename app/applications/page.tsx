'use client';

import SignInScreen from '@/app/components/SignInScreen';
import ProfileForm from '@/app/components/ProfileForm';
import Sidebar from '@/app/components/Sidebar';
import ApplicationsScreen from '@/app/components/ApplicationsScreen';
import SplashScreen from '@/app/components/SplashScreen';
import { useAuth } from '@/app/providers/AuthProvider';
import { useProfile } from '@/app/hooks/useProfile';
import { useApplications } from '@/app/hooks/useApplications';

export default function ApplicationsPage() {
  const { user, loading: authLoading } = useAuth();
  const { profile, loading: profileLoading, save } = useProfile();
  const { applications, loading: appsLoading, error, update, remove } = useApplications();

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
          <ApplicationsScreen
            applications={applications}
            loading={appsLoading}
            error={error}
            onUpdate={update}
            onRemove={remove}
          />
        </div>
      </main>
    </div>
  );
}
