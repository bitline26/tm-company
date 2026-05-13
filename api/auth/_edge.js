// Edge Runtime 호환 인증/세션 유틸 — Web Crypto API 사용
// 기존 _db.js (Node node:crypto) 와 동일한 HMAC/PBKDF2 포맷 → 세션/해시 cross-compatible
import { neon } from '@neondatabase/serverless';

const isProd = process.env.VERCEL_ENV === 'production';
const dbUrl = isProd
  ? (process.env.DATABASE_URL || process.env.POSTGRES_URL)
  : (process.env.test2_DATABASE_URL
     || process.env.test2_POSTGRES_URL
     || process.env.DATABASE_URL
     || process.env.POSTGRES_URL);
export const sql = neon(dbUrl);

export const PRESET_NAMES = [
  '문실장','김상현','이경민','임세인','양정연','장영인',
  '안다혜','지성훈','이기성','고윤호','박철우','최은정',
];

const enc = new TextEncoder();
const dec = new TextDecoder();

function bytesToHex(bytes) {
  const arr = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes[i].toString(16).padStart(2, '0');
  return arr.join('');
}
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function bytesToB64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64UrlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
  return r === 0;
}

const PBKDF2_ITER = 10000;
// Node 측은 salt를 hex 문자열 그대로(utf-8 바이트) PBKDF2에 투입 → Edge도 동일 포맷으로 매칭
export async function verifyPasswordEdge(password, hash, salt) {
  if (!hash || !salt) return false;
  const baseKey = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: PBKDF2_ITER },
    baseKey, 256
  );
  return timingSafeEqual(new Uint8Array(derived), hexToBytes(hash));
}

const SESSION_SECRET = process.env.SESSION_SECRET
  || 'tm-company-default-session-secret-please-set-SESSION_SECRET-env';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

let hmacKeyP = null;
function getHmacKey() {
  if (!hmacKeyP) {
    hmacKeyP = crypto.subtle.importKey(
      'raw', enc.encode(SESSION_SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
  }
  return hmacKeyP;
}

export async function signSessionEdge(payload) {
  const exp = Date.now() + SESSION_TTL_MS;
  const json = JSON.stringify({ ...payload, exp });
  const b64 = bytesToB64Url(enc.encode(json));
  const key = await getHmacKey();
  const sigBytes = await crypto.subtle.sign('HMAC', key, enc.encode(b64));
  const sig = bytesToB64Url(new Uint8Array(sigBytes));
  return `${b64}.${sig}`;
}

export async function verifySessionEdge(token) {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const b64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!b64 || !sig) return null;
  const key = await getHmacKey();
  const expBytes = await crypto.subtle.sign('HMAC', key, enc.encode(b64));
  const got = b64UrlToBytes(sig);
  if (!timingSafeEqual(got, new Uint8Array(expBytes))) return null;
  try {
    const payload = JSON.parse(dec.decode(b64UrlToBytes(b64)));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

export function parseCookieHeader(header) {
  const out = {};
  (header || '').split(';').forEach(c => {
    const i = c.indexOf('=');
    if (i === -1) return;
    const k = c.slice(0, i).trim();
    const v = c.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

export function sessionCookie(token) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `tm_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function ymToRange(ym) {
  const start = `${ym}-01`;
  const [y, m] = ym.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const end = `${ny}-${String(nm).padStart(2, '0')}-01`;
  return { start, end };
}

export function json(payload, init) {
  const headers = new Headers(init?.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(payload), { status: init?.status ?? 200, headers });
}
