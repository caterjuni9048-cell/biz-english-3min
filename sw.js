// 앱 파일 보관소.
// - lib/, models/ (AI 엔진·모델, 약 65MB): 한 번 받으면 폰에 보관하고 다시 받지 않는다.
// - 나머지(화면, 음성): 인터넷이 되면 매번 서버에 새 버전이 있는지 확인하고(저장본 재사용 안 함), 안 되면 보관본을 쓴다.
const BIG = 'bizeng-ai-v1';
const PAGE = 'bizeng-page-v2';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== BIG && k !== PAGE) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('fetch', e => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== location.origin) return;
  if (/\/(lib|models)\//.test(u.pathname)) {
    e.respondWith(caches.open(BIG).then(async c => {
      const hit = await c.match(req, {ignoreSearch: true});
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok && r.status === 200) await c.put(req, r.clone());
      return r;
    }));
    return;
  }
  e.respondWith(fetch(req, {cache: 'no-cache'}).then(r => {
    if (r.ok && r.status === 200) { const cl = r.clone(); caches.open(PAGE).then(c => c.put(req, cl)); }
    return r;
  }).catch(() => caches.match(req, {ignoreSearch: true}).then(m => m || Response.error())));
});

// 푸시 알림 받기 → 알림 띄우기, 누르면 앱 열기
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || '3분 영어', {
    body: d.body || '지금 3분만 공부해 볼까요?', icon: 'icon-192.png', badge: 'icon-192.png',
    tag: d.tag || 'bizeng', renotify: true, data: { url: d.url || './' },
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.indexOf('/biz-english-3min/') >= 0 && 'focus' in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
