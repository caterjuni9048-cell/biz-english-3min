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
