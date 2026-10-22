import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Store, fail, PHRASES } from './domain.mjs';
import { geocode, route, speedLimit } from './providers.mjs';
import { VoiceRooms, weather } from './extras.mjs';

const root = path.resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
export function createServer(store = new Store()) {
  const rates = new Map();
  const voice = new VoiceRooms(store);
  const cleanup = setInterval(() => { store.prune(); for (const [k,v] of rates) if (Date.now() - v.time > 60000) rates.delete(k); }, 10000);
  cleanup.unref();
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(self), microphone=(self), camera=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://tile.openstreetmap.org; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    const reply = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET') fail('Method not allowed.', 405);
        const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
        const target = path.resolve(root, '.' + pathname);
        if (!target.startsWith(root + path.sep) && target !== root) fail('Not found.', 404);
        let content; try { content = await readFile(target); } catch { fail('Not found.', 404); }
        res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream' }); res.end(content); return;
      }
      const origin = req.headers.origin;
      const allowed = process.env.PUBLIC_ORIGIN || `http://${req.headers.host}`;
      if (origin && origin !== allowed) fail('Origin not allowed.', 403);
      const ip = req.socket.remoteAddress;
      const bucket = rates.get(ip) || { time: Date.now(), count: 0, sessions: 0 };
      if (Date.now() - bucket.time > 60000) Object.assign(bucket, { time: Date.now(), count: 0, sessions: 0 });
      rates.set(ip, bucket);
      if (++bucket.count > 240) fail('Too many requests.', 429);
      let body = {};
      if (['POST', 'PUT'].includes(req.method)) {
        if (!req.headers['content-type']?.startsWith('application/json')) fail('Use application/json.', 415);
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (raw.length > (url.pathname==='/api/voice/signal'?32768:4096)) fail('Request too large.', 413); }
        try { body = JSON.parse(raw); } catch { fail('Invalid JSON.'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Expected an object.');
      }
      const key = `${req.method} ${url.pathname}`;
      if (key === 'GET /api/health') return reply(200, { ok: true, version: '0.1.0' });
      if (key === 'GET /api/config') return reply(200, { phrases: PHRASES, scanInterval: 2000, presenceTTL: 12000, iceServers: JSON.parse(process.env.ICE_SERVERS || '[]') });
      if (key === 'POST /api/session') {
        if (++bucket.sessions > 10) fail('Too many sessions. Try again in a minute.', 429);
        return reply(201, store.create());
      }
      const token = req.headers.authorization?.replace(/^Bearer /, '');
      const u = store.auth(token);
      switch (key) {
        case 'DELETE /api/session': store.sessions.delete(token); return reply(200, { ok: true });
        case 'PUT /api/profile': return reply(200, store.profile(u, body));
        case 'PUT /api/location': return reply(200, store.locate(u, body));
        case 'GET /api/nearby': return reply(200, store.nearby(u));
        case 'GET /api/messages': return reply(200, store.inbox(u));
        case 'POST /api/messages': return reply(201, store.send(u, body));
        case 'POST /api/reports': return reply(201, store.report(u, body));
        case 'POST /api/block': return reply(200, store.block(u, body.id));
        case 'POST /api/flag': return reply(200, store.flag(u, body.id));
        case 'GET /api/geocode': return reply(200, await geocode(url.searchParams.get('q')));
        case 'POST /api/route': return reply(200, await route(body.start, body.end));
        case 'POST /api/speed-limit': return reply(200, await speedLimit(body));
        case 'POST /api/weather': return reply(200, await weather(body));
        case 'PUT /api/voice': return reply(200, voice.enable(u,body.enabled));
        case 'GET /api/voice': return reply(200, voice.poll(u));
        case 'POST /api/voice/signal': return reply(200, voice.send(u,body));
        default: fail('Not found.', 404);
      }
    } catch (error) { reply(error.status || 500, { error: error.status ? error.message : 'Service unavailable. Please try again.' }); }
  });
  server.on('close', () => clearInterval(cleanup));
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  createServer().listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Automaps is ready at http://localhost:${port}`));
}
