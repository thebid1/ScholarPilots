'use client';

import { Suspense } from 'react';
import SignInScreen from '@/app/components/SignInScreen';
import ProfileForm from '@/app/components/ProfileForm';
import Sidebar from '@/app/components/Sidebar';
import ChatInterface from '@/app/components/ChatInterface';
import SplashScreen from '@/app/components/SplashScreen';
import { useAuth } from '@/app/providers/AuthProvider';
import { useProfile } from '@/app/hooks/useProfile';
import { useApplications } from '@/app/hooks/useApplications';

export default function ChatPage() {
  const { user, loading: authLoading } = useAuth();
  const { profile, loading: profileLoading, save } = useProfile();
  const { applications } = useApplications();

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
    <div className="h-[100dvh] flex flex-col md:flex-row page-bg pb-20 md:pb-0">
      <Sidebar />
      <div className="flex-1 min-w-0 h-full">
        {/* ChatInterface reads ?scholarship= via useSearchParams, which the App
            Router requires be wrapped in a Suspense boundary. */}
        <Suspense fallback={<SplashScreen />}>
          <ChatInterface profile={profile} applications={applications} />
        </Suspense>
      </div>
    </div>
  );
}
