import { randomBytes, randomUUID } from 'node:crypto';

export const PHRASES = ['Thanks, neighbor!', 'You can merge ahead.', 'Your lights are off.', 'Safe travels!', 'Hazard ahead.', 'Nice car! 👍', 'Hello, neighbor! 👋', 'Thank you! 🙌', 'After you! 🤝', 'Drive safe! 💚', 'Your trunk is open.', 'Your tire looks low.', 'Please keep some distance.', 'Enjoy the drive! ☀️'];
export const TYPES = ['hazard', 'camera', 'police'];
export const TTL = 12_000;
const badWords = /\b(fuck|shit|bitch|asshole|cunt|nigger|faggot)\b/i;
export function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
export function clean(value, max = 40) {
  if (typeof value !== 'string') fail('Text is required.');
  const text = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!text || text.length > max || /[<>\p{Cc}\p{Cf}]/u.test(text) || badWords.test(text)) fail('Please use appropriate, plain text.');
  return text;
}
export function coordinate(p) {
  if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng) || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) fail('Invalid coordinates.');
  return { lat: p.lat, lng: p.lng };
}
export function distance(a, b) {
  const rad = x => x * Math.PI / 180;
  const dlat = rad(b.lat - a.lat), dlng = rad(b.lng - a.lng);
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dlng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(Math.min(1, h)), Math.sqrt(Math.max(0, 1 - h)));
}
export class Store {
  constructor(now = Date.now) { this.now = now; this.sessions = new Map(); this.reports = []; this.messages = []; this.flags = []; }
  create() {
    this.prune();
    if (this.sessions.size >= 5000) fail('Server is at capacity.', 503);
    const token = randomBytes(32).toString('hex');
    const user = { id: randomUUID(), alias: `Ghost ${randomBytes(2).toString('hex').toUpperCase()}`, mode: 'ghost', name: '', make: '', model: '', radius: 30, blocked: new Set(), expires: this.now() + 3600000, lastMessage: -Infinity, lastReport: -Infinity };
    this.sessions.set(token, user);
    return { token, id: user.id, alias: user.alias, expires: user.expires };
  }
  auth(token) {
    const u = this.sessions.get(token);
    if (!u || u.expires < this.now()) fail('Session expired. Reconnect to live mode.', 401);
    return u;
  }
  profile(u, body) {
    if (!['ghost', 'active'].includes(body.mode)) fail('Choose Ghost or Active.');
    if (![10, 20, 30].includes(body.radius)) fail('Radius must be 10, 20, or 30 feet.');
    const next = body.mode === 'active' ? { name: clean(body.name, 24), make: clean(body.make, 30), model: clean(body.model, 30) } : { name: '', make: '', model: '' };
    Object.assign(u, next, { mode: body.mode, radius: body.radius });
    return this.public(u);
  }
  public(u) {
    return { id: u.id, mode: u.mode, name: u.mode === 'ghost' ? u.alias : u.name, make: u.mode === 'ghost' ? null : u.make, model: u.mode === 'ghost' ? null : u.model };
  }
  locate(u, body) {
    const p = coordinate(body);
    if (!Number.isFinite(body.accuracy) || body.accuracy < 0 || body.accuracy > 10000) fail('Invalid GPS accuracy.');
    if (!Number.isFinite(body.timestamp) || Math.abs(this.now() - body.timestamp) > TTL) fail('A fresh GPS fix is required.');
    if (body.speed !== null && (!Number.isFinite(body.speed) || body.speed < 0 || body.speed > 150)) fail('Invalid speed.');
    if (u.location && body.timestamp < u.location.timestamp) fail('Outdated GPS fix.');
    u.location = { ...p, accuracy: body.accuracy, timestamp: body.timestamp, speed: body.speed };
    return { ok: true };
  }
  fresh(u) { return !!u.location && this.now() - u.location.timestamp <= TTL; }
  eligible(a, b) {
    if (a === b || !this.fresh(a) || !this.fresh(b) || a.blocked.has(b.id) || b.blocked.has(a.id)) return false;
    // Conservative upper bound: do not imply reliable lane/car discrimination from GPS.
    return distance(a.location, b.location) + a.location.accuracy + b.location.accuracy <= Math.min(a.radius, b.radius) * 0.3048;
  }
  nearby(u) {
    this.prune();
    const peers = [...this.sessions.values()].filter(p => this.eligible(u, p)).map(p => ({ ...this.public(p), lat: p.location.lat, lng: p.location.lng, distanceFt: Math.round(distance(u.location, p.location) / 0.3048), accuracyFt: Math.round((u.location.accuracy + p.location.accuracy) / 0.3048) })).sort((a, b) => a.distanceFt - b.distanceFt);
    return { peers, scannedAt: this.now(), locationFresh: this.fresh(u), accuracyLimited: this.fresh(u) && u.location.accuracy * 2 > u.radius * 0.3048, reports: this.fresh(u) ? this.reports.filter(r => distance(u.location, r) < 5000).map(({ reporter, ...r }) => r) : [] };
  }
  send(u, body) {
    const peer = [...this.sessions.values()].find(p => p.id === body.to);
    if (!peer || !this.eligible(u, peer)) fail('Driver is outside your confirmed range.', 409);
    const text = clean(body.text, 240);
    if ((u.location.speed === null || u.location.speed > 0.5) && !PHRASES.includes(text)) fail('Use a quick reply while moving or when speed is unknown.', 403);
    if (this.now() - u.lastMessage < 1500) fail('Please wait before sending another message.', 429);
    u.lastMessage = this.now();
    const m = { id: randomUUID(), from: u.id, to: peer.id, text, timestamp: this.now() };
    this.messages.push(m);
    return { ...m, sender: this.public(u) };
  }
  inbox(u) {
    this.prune();
    const users = new Map([...this.sessions.values()].map(p => [p.id, p]));
    return this.messages.filter(m => m.from === u.id || m.to === u.id).filter(m => {
      const peer = users.get(m.from === u.id ? m.to : m.from);
      return peer && !u.blocked.has(peer.id) && !peer.blocked.has(u.id);
    }).map(m => ({ ...m, sender: this.public(users.get(m.from)) }));
  }
  report(u, body) {
    if (!this.fresh(u)) fail('A fresh location is needed to report here.');
    if (!TYPES.includes(body.type)) fail('Invalid report type.');
    if (this.now() - u.lastReport < 30000) fail('Please wait 30 seconds between reports.', 429);
    u.lastReport = this.now();
    const r = { id: randomUUID(), type: body.type, lat: u.location.lat, lng: u.location.lng, timestamp: this.now(), expires: this.now() + (body.type === 'camera' ? 3600000 : 900000), reporter: u.id };
    this.reports.push(r);
    const { reporter, ...result } = r;
    return result;
  }
  block(u, id) {
    if (typeof id !== 'string' || id.length > 80) fail('Invalid driver.');
    u.blocked.add(id);
    return { ok: true };
  }
  flag(u, id) {
    const m = this.messages.find(m => m.id === id && m.to === u.id);
    if (!m) fail('Message not found.', 404);
    if (!this.flags.some(f => f.messageId === id && f.reporter === u.id)) this.flags.push({ messageId: id, reporter: u.id, timestamp: this.now() });
    this.block(u, m.from);
    return { ok: true };
  }
  prune() {
    const now = this.now();
    for (const [token, u] of this.sessions) {
      if (u.expires < now) this.sessions.delete(token);
      else if (u.location && now - u.location.timestamp > TTL) delete u.location;
    }
    this.reports = this.reports.filter(r => r.expires > now);
    this.messages = this.messages.filter(m => now - m.timestamp < 300000);
    this.flags = this.flags.filter(f => now - f.timestamp < 3600000);
  }
}
