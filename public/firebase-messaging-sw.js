/* eslint-disable no-undef */
/*
 * Firebase Cloud Messaging background handler.
 *
 * FCM requires this file at exactly /firebase-messaging-sw.js — it cannot be
 * merged into /sw.js, which stays the offline cache worker.
 *
 * Files in public/ are served verbatim, so NEXT_PUBLIC_* values are not inlined
 * here. The config arrives as query params on the registration URL instead
 * (see app/hooks/useNotifications.ts).
 */

// Keep these pinned to the `firebase` version in package.json — the worker and
// the page must agree on the FCM wire format.
importScripts('https://www.gstatic.com/firebasejs/12.17.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.17.0/firebase-messaging-compat.js');

const params = new URL(self.location).searchParams;

const config = {
  apiKey: params.get('apiKey'),
  authDomain: params.get('authDomain'),
  projectId: params.get('projectId'),
  storageBucket: params.get('storageBucket'),
  messagingSenderId: params.get('messagingSenderId'),
  appId: params.get('appId'),
};

if (config.apiKey && config.projectId && config.messagingSenderId) {
  firebase.initializeApp(config);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const { title, body } = payload.notification ?? {};
    self.registration.showNotification(title ?? 'ScholarPilot', {
      body: body ?? 'You have an upcoming deadline.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: payload.data?.applicationId ?? 'scholarpilot-deadline',
      data: { url: payload.data?.url ?? '/applications' },
    });
  });
}

// Tapping a reminder should land on the pipeline, reusing an open tab if there
// is one rather than stacking duplicate windows.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? '/applications';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
