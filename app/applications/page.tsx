'use client';

import { useEffect, useState } from 'react';
import { UserProfile, Application, UserSession } from '@/app/types';
import { getProfile, saveProfile, getApplications, saveApplications, getSession, saveSession } from '@/app/lib/storage';
import SignInScreen from '@/app/components/SignInScreen';
import ProfileForm from '@/app/components/ProfileForm';
import Sidebar from '@/app/components/Sidebar';
import ApplicationsScreen from '@/app/components/ApplicationsScreen';
import SplashScreen from '@/app/components/SplashScreen';

export default function ApplicationsPage() {
  const [session, setSession] = useState<UserSession | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setSession(getSession());
    setProfile(getProfile());
    setApplications(getApplications());
    setLoaded(true);
  }, []);

  function handleSignIn(s: UserSession) {
    saveSession(s);
    setSession(s);
  }

  function handleProfileComplete(p: UserProfile) {
    saveProfile(p);
    setProfile(p);
  }

  function handleUpdate(updated: Application[]) {
    setApplications(updated);
    saveApplications(updated);
  }

  if (!loaded) {
    return <SplashScreen />;
  }

  if (!session) {
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
          <ApplicationsScreen applications={applications} onUpdate={handleUpdate} />
        </div>
      </main>
    </div>
  );
}
