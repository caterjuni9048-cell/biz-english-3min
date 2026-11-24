// 3분 영어 푸시 알림 서버 (Cloudflare Workers, 무료 요금제)
// - 앱이 알림 설정(시각·매시간·요일·반복)과 푸시 주소를 /sub 로 보낸다.
// - 1분마다(cron) 한국 시간으로 보낼 알림이 있는지 보고 Web Push 로 보낸다.
// - 앱이 한 판을 끝내면 /done 으로 알려 주어, 반복 알림을 멈춘다.
// 저장소: KV 바인딩 "KV" (키 subs = 등록 id 목록, sub:<id> = 설정)
// 비밀값: VAPID_PRIVATE_JWK (Cloudflare 비밀 변수), 공개키: VAPID_PUBLIC (일반 변수)

const ALLOW_ORIGIN = 'https://caterjuni9048-cell.github.io';
const APP_URL = 'https://caterjuni9048-cell.github.io/biz-english-3min/';
const MAX_SUBS = 20;
const KST = 9 * 3600 * 1000;

// ---------- 작은 도구 ----------
const enc = new TextEncoder();
function b64u(buf) { let s = ''; new Uint8Array(buf).forEach(b => s += String.fromCharCode(b)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64u(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
function cat(...arrs) { let n = 0; arrs.forEach(a => n += a.length); const o = new Uint8Array(n); let p = 0; arrs.forEach(a => { o.set(a, p); p += a.length; }); return o; }
async function hmac(key, data) { const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return new Uint8Array(await crypto.subtle.sign('HMAC', k, data)); }
async function hkdf(salt, ikm, info, len) { const prk = await hmac(salt, ikm); return (await hmac(prk, cat(info, new Uint8Array([1])))).slice(0, len); }

// ---------- Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID) ----------
export async function encryptPayload(sub, text) {
  const ua = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(auth, shared, cat(enc.encode('WebPush: info\0'), ua, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(enc.encode(text), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}
async function vapidAuth(endpoint, env) {
  const aud = new URL(endpoint).origin;
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: APP_URL })));
  const key = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + body));
  return 'vapid t=' + head + '.' + body + '.' + b64u(sig) + ', k=' + env.VAPID_PUBLIC;
}
export async function sendPush(sub, msg, env, fetchFn = fetch) {
  const body = await encryptPayload(sub, JSON.stringify(msg));
  const r = await fetchFn(sub.endpoint, { method: 'POST', headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '1800', Urgency: 'high', Topic: 'bizeng', Authorization: await vapidAuth(sub.endpoint, env) }, body });
  return r.status;
}

// ---------- 시간 계산 (한국 시간) ----------
function kstParts(ms) { const d = new Date(ms + KST); return { date: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes(), dow: d.getUTCDay() }; }
function hm(s) { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? (+m[1]) * 60 + (+m[2]) : -1; }
function slotsOf(cfg) {
  const out = [];
  (cfg.times || []).forEach(t => { const m = hm(t); if (m >= 0) out.push({ m, kind: 'time' }); });
  if (cfg.hourly && cfg.hourly.on) { for (let h = +cfg.hourly.from; h <= +cfg.hourly.to; h++) out.push({ m: h * 60, kind: 'hour' }); }
  const seen = {}; return out.filter(s => !seen[s.m] && (seen[s.m] = 1)).sort((a, b) => a.m - b.m);
}
// 지금(분) 보낼 알림 결정. 반환: null 또는 {title, body, tag}
export function decide(rec, nowMs) {
  const cfg = rec.cfg || {}; if (!cfg.on) return null;
  const k = kstParts(nowMs);
  const days = cfg.days && cfg.days.length ? cfg.days : [0, 1, 2, 3, 4, 5, 6];
  if (days.indexOf(k.dow) < 0) return null;
  if (cfg.aiTime && hm(cfg.aiTime) === k.min) return { title: '3분 영어 · AI 복습', body: '오늘 배운 표현으로 AI와 3분 대화 복습해요', tag: 'bizeng-ai', url: APP_URL + '#aireview' };
  const allDone = rec.allDoneDate === k.date;
  if (allDone && cfg.stopWhenDone !== false) return null;
  const left = 3 - (rec.doneDate === k.date ? (rec.doneCount || 0) : 0);
  const slots = slotsOf(cfg);
  for (const s of slots) if (s.m === k.min) return { title: '3분 영어', body: left > 0 ? `지금 3분만! 오늘 남은 판 ${left}개` : '복습 한 번 더 해 볼까요? (3분)', tag: 'bizeng-' + s.m };
  const rp = cfg.repeat || {};
  if (rp.on) {
    const every = Math.max(5, +rp.every || 10), max = Math.min(3, Math.max(1, +rp.max || 2));
    for (const s of slots) {
      if (s.kind !== 'time') continue;
      for (let i = 1; i <= max; i++) {
        if (s.m + i * every !== k.min) continue;
        const slotMs = Date.parse(k.date + 'T00:00:00+09:00') + s.m * 60000;
        if ((rec.lastActive || 0) >= slotMs) return null; // 알림 뒤에 공부했으면 반복 안 함
        return { title: '3분 영어 · 다시 알림', body: `아직이에요. 지금 3분이면 끝! (${i}/${max})`, tag: 'bizeng-' + s.m };
      }
    }
  }
  return null;
}

// ---------- 저장 ----------
async function getIds(env) { return (await env.KV.get('subs', 'json')) || []; }
async function putRec(env, id, rec) { await env.KV.put('sub:' + id, JSON.stringify(rec)); }
async function getRec(env, id) { return env.KV.get('sub:' + id, 'json'); }

function cors(origin) { return { 'Access-Control-Allow-Origin': origin === ALLOW_ORIGIN || /^http:\/\/localhost(:\d+)?$/.test(origin || '') ? origin : ALLOW_ORIGIN, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' }; }
function json(o, status, origin) { return new Response(JSON.stringify(o), { status: status || 200, headers: { 'Content-Type': 'application/json', ...cors(origin) } }); }
function validId(id) { return typeof id === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(id); }
function cleanCfg(c) {
  c = c || {};
  const times = (Array.isArray(c.times) ? c.times : []).filter(t => hm(t) >= 0).slice(0, 12);
  const h = c.hourly || {}, r = c.repeat || {};
  return {
    on: !!c.on, times,
    hourly: { on: !!h.on, from: Math.min(23, Math.max(0, +h.from || 9)), to: Math.min(23, Math.max(0, +h.to || 18)) },
    days: (Array.isArray(c.days) ? c.days : [0, 1, 2, 3, 4, 5, 6]).map(Number).filter(d => d >= 0 && d <= 6),
    repeat: { on: !!r.on, every: [5, 10, 15, 20, 30].indexOf(+r.every) >= 0 ? +r.every : 10, max: Math.min(3, Math.max(1, +r.max || 2)) },
    stopWhenDone: c.stopWhenDone !== false,
    aiTime: hm(c.aiTime) >= 0 ? c.aiTime : '',
  };
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
    const url = new URL(req.url);
    try {
      if (req.method === 'GET' && url.pathname === '/vapid') return json({ key: env.VAPID_PUBLIC }, 200, origin);
      if (req.method === 'GET' && url.pathname === '/') return json({ ok: true, name: '3min-english-push' }, 200, origin);
      if (req.method !== 'POST') return json({ error: 'not found' }, 404, origin);
      const b = await req.json().catch(() => ({}));
      if (!validId(b.id)) return json({ error: 'bad id' }, 400, origin);
      if (url.pathname === '/sub') {
        const s = b.sub;
        if (!s || typeof s.endpoint !== 'string' || !/^https:\/\//.test(s.endpoint) || !s.keys || !s.keys.p256dh || !s.keys.auth) return json({ error: 'bad subscription' }, 400, origin);
        const ids = await getIds(env);
        if (ids.indexOf(b.id) < 0) { if (ids.length >= MAX_SUBS) return json({ error: 'full' }, 429, origin); ids.push(b.id); await env.KV.put('subs', JSON.stringify(ids)); }
        const old = (await getRec(env, b.id)) || {};
        await putRec(env, b.id, { ...old, sub: { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } }, cfg: cleanCfg(b.cfg), updated: Date.now() });
        return json({ ok: true }, 200, origin);
      }
      const rec = await getRec(env, b.id);
      if (!rec) return json({ error: 'unknown id' }, 404, origin);
      if (url.pathname === '/done') {
        const k = kstParts(Date.now());
        rec.lastActive = Date.now();
        if (rec.doneDate !== k.date) { rec.doneDate = k.date; rec.doneCount = 0; }
        rec.doneCount = Math.max(rec.doneCount || 0, Math.min(3, +b.count || 0));
        if (b.all) rec.allDoneDate = k.date;
        await putRec(env, b.id, rec);
        return json({ ok: true }, 200, origin);
      }
      if (url.pathname === '/test') {
        const st = await sendPush(rec.sub, { title: '3분 영어 · 시험 알림', body: '알림이 잘 옵니다. 누르면 앱이 열립니다.', tag: 'bizeng-test', url: APP_URL }, env);
        return json({ ok: st >= 200 && st < 300, status: st }, 200, origin);
      }
      if (url.pathname === '/unsub') {
        await env.KV.delete('sub:' + b.id);
        await env.KV.put('subs', JSON.stringify((await getIds(env)).filter(x => x !== b.id)));
        return json({ ok: true }, 200, origin);
      }
      return json({ error: 'not found' }, 404, origin);
    } catch (e) { return json({ error: 'server error' }, 500, origin); }
  },
  async scheduled(event, env) {
    const now = event.scheduledTime || Date.now();
    if (kstParts(now).min % 30 === 0) await env.KV.put('health', JSON.stringify({ lastCron: now })); // 30분마다 살아 있음 기록(쓰기 하루 48회)
    const ids = await getIds(env); let changed = false;
    for (const id of ids.slice()) {
      const rec = await getRec(env, id); if (!rec || !rec.sub) continue;
      const msg = decide(rec, now); if (!msg) continue;
      try {
        const st = await sendPush(rec.sub, { url: APP_URL, ...msg }, env);
        rec.lastSend = { t: now, status: st }; await putRec(env, id, rec);
        if (st === 404 || st === 410) { await env.KV.delete('sub:' + id); ids.splice(ids.indexOf(id), 1); changed = true; }
      } catch (e) { rec.lastSend = { t: now, error: String(e).slice(0, 120) }; await putRec(env, id, rec); }
    }
    if (changed) await env.KV.put('subs', JSON.stringify(ids));
  },
};
