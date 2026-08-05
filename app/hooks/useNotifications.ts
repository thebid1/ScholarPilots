'use client';

import { useCallback, useEffect, useState } from 'react';
import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { getFirebaseApp } from '@/lib/firebase/client';
import { removeFcmToken, saveFcmToken } from '@/app/lib/user-store';
import { useAuth } from '@/app/providers/AuthProvider';

type PermissionState = 'unsupported' | 'default' | 'granted' | 'denied';

const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;

/**
 * The messaging worker lives in public/, so it can't read NEXT_PUBLIC_* at build
 * time. Pass the config on the registration URL — the worker reads it back off
 * its own location.
 */
function swUrl(): string {
  const params = new URLSearchParams({
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '',
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '',
  });
  return `/firebase-messaging-sw.js?${params.toString()}`;
}

/**
 * Deadline reminder opt-in.
 *
 * Permission is requested from an explicit user action, never on load —
 * browsers penalise unprompted prompts, and a denial is close to permanent.
 *
 * iOS caveat: web push only works when the PWA is installed to the home screen
 * (16.4+). `needsInstall` surfaces that so the UI can point at InstallPrompt
 * instead of silently failing.
 */
export function useNotifications() {
  const { user } = useAuth();
  const [permission, setPermission] = useState<PermissionState>('default');
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    isSupported()
      .then((ok) => {
        if (cancelled) return;
        if (!ok || typeof Notification === 'undefined') {
          setPermission('unsupported');
          return;
        }
        setPermission(Notification.permission as PermissionState);
      })
      .catch(() => {
        if (!cancelled) setPermission('unsupported');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Foreground messages don't reach the service worker, so show them here.
  useEffect(() => {
    if (permission !== 'granted') return;
    const app = getFirebaseApp();
    if (!app) return;

    let unsubscribe: (() => void) | undefined;
    isSupported().then((ok) => {
      if (!ok) return;
      unsubscribe = onMessage(getMessaging(app), (payload) => {
        const { title, body } = payload.notification ?? {};
        if (Notification.permission === 'granted') {
          new Notification(title ?? 'ScholarPilot', {
            body: body ?? 'You have an upcoming deadline.',
            icon: '/icon-192.png',
          });
        }
      });
    });
    return () => unsubscribe?.();
  }, [permission]);

  // Permission survives reloads but the token doesn't live in React state, so
  // re-read it on mount. This also refreshes a token FCM has rotated, and
  // re-adds one the cron pruned as stale.
  useEffect(() => {
    if (permission !== 'granted' || !user || token || !VAPID_KEY) return;
    const app = getFirebaseApp();
    if (!app) return;

    let cancelled = false;
    (async () => {
      try {
        if (!(await isSupported())) return;
        const registration = await navigator.serviceWorker.register(swUrl());
        const existing = await getToken(getMessaging(app), {
          vapidKey: VAPID_KEY,
          serviceWorkerRegistration: registration,
        });
        if (!existing || cancelled) return;
        await saveFcmToken(user.uid, existing);
        if (!cancelled) setToken(existing);
      } catch {
        // Silent: the user hasn't asked for anything here. `enable` surfaces errors.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [permission, user, token]);

  const enable = useCallback(async () => {
    if (!user) return;
    setError(null);

    const app = getFirebaseApp();
    if (!app) return setError('Notifications are unavailable — Firebase is not configured.');
    if (!VAPID_KEY) return setError('Notifications are unavailable — no web push key is set.');
    if (!(await isSupported())) return setPermission('unsupported');

    setBusy(true);
    try {
      const result = await Notification.requestPermission();
      setPermission(result as PermissionState);
      if (result !== 'granted') return;

      const registration = await navigator.serviceWorker.register(swUrl());
      const fresh = await getToken(getMessaging(app), {
        vapidKey: VAPID_KEY,
        serviceWorkerRegistration: registration,
      });
      if (!fresh) return setError('Could not obtain a push token. Try again.');

      await saveFcmToken(user.uid, fresh);
      setToken(fresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enable notifications');
    } finally {
      setBusy(false);
    }
  }, [user]);

  const disable = useCallback(async () => {
    if (!user || !token) return;
    // Only drops this device's token. Browser permission itself can only be
    // revoked from site settings, so the UI must not claim otherwise.
    try {
      await removeFcmToken(user.uid, token);
      setToken(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disable notifications');
    }
  }, [user, token]);

  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in navigator && Boolean((navigator as { standalone?: boolean }).standalone)));

  const isIOS =
    typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);

  return {
    permission,
    enabled: permission === 'granted' && Boolean(token),
    busy,
    error,
    enable,
    disable,
    /** iOS Safari needs the PWA installed before push works at all. */
    needsInstall: isIOS && !isStandalone,
  };
}
