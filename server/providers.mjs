import { coordinate, fail, distance } from './domain.mjs';

const userAgent = process.env.MAP_USER_AGENT || 'Automaps-development/0.1';
async function json(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(10000), headers: { 'User-Agent': userAgent, ...options.headers } });
  if (!response.ok) fail('Map provider is unavailable. Please try again.', 502);
  return response.json();
}
const geocache = new Map();
let nextGeocode = 0;
export async function geocode(query) {
  if (typeof query !== 'string' || query.trim().length < 3 || query.length > 160) fail('Enter a place or address.');
  const key = query.trim().toLowerCase();
  const existing = geocache.get(key);
  if (existing && Date.now() - existing.time < 86400000) return existing.results;
  // One request per second across the entire process, never autocomplete.
  if (Date.now() < nextGeocode) fail('Please wait a second between place searches.', 429);
  nextGeocode = Date.now() + 1100;
  const url = new URL('/search', process.env.GEOCODER_URL || 'https://nominatim.openstreetmap.org');
  url.search = new URLSearchParams({ q: query, format: 'jsonv2', limit: '5' });
  const rows = await json(url);
  const results = rows.map(r => ({ label: r.display_name, lat: Number(r.lat), lng: Number(r.lon) }));
  if (geocache.size > 500) geocache.delete(geocache.keys().next().value);
  geocache.set(key, { time: Date.now(), results });
  return results;
}
export async function route(start, end) {
  coordinate(start); coordinate(end);
  const base = process.env.ROUTER_URL || 'https://router.project-osrm.org';
  const url = `${base.replace(/\/$/, '')}/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson&steps=true`;
  const data = await json(url);
  if (data.code !== 'Ok' || !data.routes?.length) fail('No driving route found.', 404);
  const r = data.routes[0];
  return { geometry: r.geometry, distance: r.distance, duration: r.duration, steps: r.legs.flatMap(l => l.steps).map(s => ({ name: s.name || 'the road', distance: s.distance, maneuver: s.maneuver })), source: 'OSRM / OpenStreetMap', trafficAware: false };
}
export function parseLimit(value) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?(?:\s*(?:mph|km\/h))?$/.test(value.trim())) return null;
  const n = parseFloat(value);
  if (n <= 0 || n > 200) return null;
  return { value: n, unit: value.includes('mph') ? 'mph' : 'km/h' };
}
function segmentDistance(p, a, b) {
  const k = Math.cos(p.lat * Math.PI / 180);
  const x = (b.lon - a.lon) * k, y = b.lat - a.lat;
  const t = Math.max(0, Math.min(1, (((p.lng - a.lon) * k) * x + (p.lat - a.lat) * y) / (x*x + y*y || 1)));
  return distance(p, { lat: a.lat + t*y, lng: a.lon + t*(b.lon-a.lon) });
}
export function matchLimit(point, elements) {
  const ways = elements.filter(e => e.geometry?.length > 1).map(e => ({ ...e, gap: Math.min(...e.geometry.slice(1).map((b, i) => segmentDistance(point, e.geometry[i], b))) })).sort((a,b) => a.gap-b.gap);
  const w = ways[0];
  // Ambiguous intersections, directional and conditional limits remain unknown.
  if (!w || w.gap > 12 || ways[1] && ways[1].gap - w.gap < 5 || Object.keys(w.tags || {}).some(k => k.startsWith('maxspeed:'))) return null;
  const limit = parseLimit(w.tags?.maxspeed);
  return limit ? { ...limit, road: w.tags?.name || 'Unnamed road', source: 'OpenStreetMap; posted data, not live signs' } : null;
}
let nextLimitFetch = 0;
export async function speedLimit(point) {
  coordinate(point);
  if (!process.env.OVERPASS_URL) return { limit: null, reason: 'Speed-limit provider is not configured.' };
  if (Date.now() < nextLimitFetch) return { limit: null, reason: 'Speed-limit lookup cooling down.' };
  nextLimitFetch = Date.now() + 15000;
  const query = `[out:json][timeout:8];way(around:35,${point.lat},${point.lng})[highway];out tags geom;`;
  const data = await json(process.env.OVERPASS_URL, { method: 'POST', body: new URLSearchParams({ data: query }) });
  return { limit: matchLimit(point, data.elements || []), checkedAt: Date.now(), reason: 'Posted map data can be missing or outdated. Follow road signs.' };
}
