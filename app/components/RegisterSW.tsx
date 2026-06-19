'use client';

import { useEffect } from 'react';

export default function RegisterSW() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    // Only register the service worker in production builds.
    // In development it can serve stale/cached files and cause 404s for _next/static chunks.
    if (process.env.NODE_ENV !== 'production') {
      // If a previous production SW is still active, unregister it so dev works cleanly.
      navigator.serviceWorker.getRegistration('/sw.js').then((reg) => {
        if (reg) {
          reg.unregister().then(() => {
            console.log('Development mode: unregistered old service worker');
          });
        }
      });
      return;
    }

    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => console.log('SW registered:', reg.scope))
      .catch((err) => console.error('SW registration failed:', err));
  }, []);

  return null;
}
