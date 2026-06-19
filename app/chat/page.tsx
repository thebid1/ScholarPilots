'use client';

import { useEffect, useState } from 'react';
import { UserProfile, Application, UserSession } from '@/app/types';
import { getProfile, saveProfile, getApplications, getSession, saveSession } from '@/app/lib/storage';
import SignInScreen from '@/app/components/SignInScreen';
import ProfileForm from '@/app/components/ProfileForm';
import Sidebar from '@/app/components/Sidebar';
import ChatInterface from '@/app/components/ChatInterface';
import SplashScreen from '@/app/components/SplashScreen';

export default function ChatPage() {
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
    <div className="h-[100dvh] flex flex-col md:flex-row page-bg pb-20 md:pb-0">
      <Sidebar />
      <div className="flex-1 min-w-0 h-full">
        <ChatInterface profile={profile} applications={applications} />
      </div>
    </div>
  );
}
