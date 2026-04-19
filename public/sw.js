self.addEventListener("push", function (event) {
  if (!event.data) return;
  let data = {};
  try {
    data = event.data.json();
  } catch {
    data = { title: "Babiqu", body: event.data.text() };
  }
  const options = {
    body: data.body || "",
    icon: data.icon || "/logo.jpeg",
    badge: data.badge || "/logo.jpeg",
    vibrate: [100, 50, 100],
    tag: data.tag || "babiqu-order",
    data: {
      url: data.url || "/dapur-9c7f3b2a",
      orderId: data.orderId,
    },
  };
  event.waitUntil(self.registration.showNotification(data.title || "Babiqu", options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/dapur-9c7f3b2a";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
