'use client';

import { useRouter } from 'next/navigation';
import { UserProfile } from '@/app/types';
import SignInScreen from '@/app/components/SignInScreen';
import ProfileForm from '@/app/components/ProfileForm';
import SplashScreen from '@/app/components/SplashScreen';
import { useAuth } from '@/app/providers/AuthProvider';
import { useProfile } from '@/app/hooks/useProfile';

/**
 * Profile editing. Reuses the onboarding wizard prefilled with the current
 * values rather than maintaining a second form that can drift out of shape.
 */
export default function ProfilePage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { profile, loading, save } = useProfile();

  if (authLoading || (user && loading)) {
    return <SplashScreen />;
  }

  if (!user) {
    return <SignInScreen />;
  }

  async function handleSave(next: UserProfile) {
    await save(next);
    router.push('/');
  }

  return (
    <ProfileForm
      initial={profile}
      onComplete={handleSave}
      submitLabel={profile ? 'Save changes' : 'Save profile'}
    />
  );
}
