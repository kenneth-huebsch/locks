self.addEventListener('push', (event) => {
  const text = event.data?.text() || 'New Locks pick';
  event.waitUntil(
    self.registration.showNotification('Locks', {
      body: text,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => 'focus' in client);
      if (existing) {
        return existing.focus();
      }
      return self.clients.openWindow('/');
    }),
  );
});
