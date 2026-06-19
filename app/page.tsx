'use client';

import { useEffect, useState } from 'react';
import { UserProfile, UserSession } from '@/app/types';
import { getProfile, saveProfile, getSession, saveSession } from '@/app/lib/storage';
import OnboardingScreen from '@/app/components/OnboardingScreen';
import SignInScreen from '@/app/components/SignInScreen';
import ProfileForm from '@/app/components/ProfileForm';
import Sidebar from '@/app/components/Sidebar';
import HomeScreen from '@/app/components/HomeScreen';
import SplashScreen from '@/app/components/SplashScreen';

export default function HomePage() {
  const [session, setSession] = useState<UserSession | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    const s = getSession();
    const p = getProfile();
    setSession(s);
    setProfile(p);
    setLoaded(true);
    if (!s) setShowOnboarding(true);
  }, []);

  function handleSignIn(s: UserSession) {
    saveSession(s);
    setSession(s);
  }

  function handleProfileComplete(p: UserProfile) {
    saveProfile(p);
    setProfile(p);
  }

  if (!loaded) {
    return <SplashScreen />;
  }

  if (!session) {
    if (showOnboarding) {
      return <OnboardingScreen onStart={() => setShowOnboarding(false)} />;
    }
    return <SignInScreen onSignIn={handleSignIn} />;
  }

  if (!profile) {
    return <ProfileForm onComplete={handleProfileComplete} />;
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
