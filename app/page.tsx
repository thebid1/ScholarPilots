'use client';

import { useEffect, useState } from 'react';
import OnboardingScreen from '@/app/components/OnboardingScreen';
import SignInScreen from '@/app/components/SignInScreen';
import ProfileForm from '@/app/components/ProfileForm';
import Sidebar from '@/app/components/Sidebar';
import HomeScreen from '@/app/components/HomeScreen';
import SplashScreen from '@/app/components/SplashScreen';
import { useAuth } from '@/app/providers/AuthProvider';
import { useProfile } from '@/app/hooks/useProfile';

export default function HomePage() {
  const { user, loading: authLoading } = useAuth();
  const { profile, loading: profileLoading, save } = useProfile();
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    // Onboarding is for first-time visitors only; a signed-in user skips it.
    if (!authLoading && !user) setShowOnboarding(true);
  }, [authLoading, user]);

  if (authLoading || (user && profileLoading)) {
    return <SplashScreen />;
  }

  if (!user) {
    if (showOnboarding) {
      return <OnboardingScreen onStart={() => setShowOnboarding(false)} />;
    }
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
          <HomeScreen />
        </div>
      </main>
    </div>
  );
}
