const $ = id => document.getElementById(id);
const PHRASES = ['Thanks, neighbor!', 'You can merge ahead.', 'Your lights are off.', 'Safe travels!', 'Hazard ahead.'];
const center = { lat: 37.79552, lng: -122.39355 };
const demoPeers = [
  { id: 'demo-1', name: 'Sunday Driver', make: 'Volvo', model: 'XC60', mode: 'active', distanceFt: 12, lat: center.lat + .000032, lng: center.lng + .000009 },
  { id: 'demo-2', name: 'Ghost 8F21', mode: 'ghost', distanceFt: 22, lat: center.lat - .000018, lng: center.lng + .000072 },
  { id: 'demo-3', name: 'Coast Mode', make: 'Porsche', model: 'Taycan', mode: 'active', distanceFt: 28, lat: center.lat + .00006, lng: center.lng - .00006 }
];
const state = { live: false, connecting: false, token: null, id: 'demo-you', profile: { mode: 'ghost', name: '', make: '', model: '', radius: 30 }, position: { ...center, accuracy: 1, speed: 0, timestamp: Date.now() }, peers: [], selected: 'demo-1', messages: [], demoMessages: [], demoReports: [], blocked: new Set(), reports: [], gpsWatch: null, start: { ...center, label: 'Demo location' }, end: null, route: null, lastLimit: 0, lastLimitPosition: null, limit: null, busy: false, view: 'map' };
const map = L.map('map', { zoomControl: false, attributionControl: true, maxZoom: 22 }).setView([center.lat + .00009, center.lng - .000025], 21);
const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxNativeZoom: 19, maxZoom: 22, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' });
const demoMap = L.imageOverlay('demo-map.svg', [[center.lat-.00045, center.lng-.0007],[center.lat+.00045, center.lng+.0007]], { attribution: 'Illustrative demo map · not for navigation' }).addTo(map);
let tileWarning = false;
tiles.on('tileerror', () => { if (!tileWarning) { tileWarning = true; toast('Map tiles unavailable. Check your connection; nearby controls still work.'); } });
const cars = L.layerGroup().addTo(map), hazards = L.layerGroup().addTo(map), routeLayer = L.layerGroup().addTo(map);
let toastTimer;
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 5500); }
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function open(id) { $(id).showModal(); }
function safe(action) { return async (...args) => { try { await action(...args); } catch (e) { toast(e.message); } }; }
async function api(path, method = 'GET', body) {
  const res = await fetch(`/api/${path}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401) { if (state.live) await stopLive(); else state.token = null; }
    throw new Error(data.error || 'Connection failed.');
  }
  return data;
}
async function session() {
  if (state.token) return;
  const data = await api('session', 'POST', {});
  state.token = data.token; state.id = data.id;
}
function vehicleIcon(self = false) { return L.divIcon({ className: `vehicle-marker${self ? ' self' : ''}`, html: '<div class="vehicle-body"></div>' + (self ? '' : '<span class="status-dot"></span>'), iconSize: [23, 40], iconAnchor: [12, 20] }); }
function carAvatar(p) {
  const avatar = el('span', `car-avatar${p.mode === 'ghost' ? ' ghost' : ''}`);
  if (p.mode === 'ghost') avatar.textContent = '◌';
  else avatar.innerHTML = '<svg viewBox="0 0 36 36" fill="none" aria-hidden="true"><path d="m8 16 3-7h14l3 7 3 3v9H5v-9Z" fill="currentColor" opacity=".8"/><path d="m11 15 2-4h10l2 4Z" fill="#34474b"/><path d="M8 23h5m10 0h5" stroke="#34474b" stroke-width="2"/><path d="M8 28v3m20-3v3" stroke="currentColor" stroke-width="3"/></svg>';
  avatar.append(el('i', 'green-dot'));
  return avatar;
}
function peerButton(p) {
  const button = el('button', 'peer' + (p.id === state.selected ? ' selected' : ''));
  button.setAttribute('aria-pressed', String(p.id === state.selected));
  button.append(carAvatar(p));
  const text = el('span', 'peer-text'); text.append(el('strong', '', p.name), el('small', '', p.mode === 'ghost' ? 'Identity hidden · Ghost mode' : `${p.make} ${p.model}`));
  button.append(text, el('span', 'peer-distance', `${p.distanceFt} ft ↗`));
  button.onclick = () => { state.selected = p.id; renderPeers(); renderChat(); map.panTo([p.lat, p.lng]); };
  return button;
}
let peersSignature = '', chatSignature = '';
function renderPeers() {
  if (!state.peers.some(p => p.id === state.selected)) { state.selected = state.peers[0]?.id ?? null; }
  const signature = JSON.stringify([state.peers,state.selected,state.profile.radius,state.position.lat,state.position.lng,!state.live || Date.now()-state.position.timestamp <= 12000,state.live]);
  if (signature === peersSignature) return;
  peersSignature = signature;
  $('peer-count').textContent = state.peers.length;
  for (const target of [$('peers'), $('driver-list')]) {
    target.replaceChildren(...state.peers.map(peerButton));
    if (!state.peers.length) target.append(el('p', 'empty', state.live ? 'No drivers confirmed within range. Others need Automaps open and a precise, fresh GPS fix.' : 'No demo drivers in this radius. Try 20 or 30 ft.'));
  }
  cars.clearLayers();
  if (!state.live || Date.now() - state.position.timestamp <= 12000) {
    L.circle([state.position.lat, state.position.lng], { radius: state.profile.radius * .3048, color: '#6ca17d', weight: 1, dashArray: '5 7', fillColor: '#b5dbab', fillOpacity: .12, interactive: false }).addTo(cars);
    L.marker([state.position.lat, state.position.lng], { icon: vehicleIcon(true), zIndexOffset: 100 }).bindTooltip('You', { permanent: true, direction: 'bottom', offset: [0, 17], className: 'car-label self-label' }).addTo(cars);
  }
  for (const p of state.peers) {
    const label = el('span', '', p.name);
    L.marker([p.lat, p.lng], { icon: vehicleIcon(), title: p.name }).bindTooltip(label, { permanent: p.id === state.selected, direction: 'top', offset: [0, -20], className: 'car-label' }).on('click', () => { state.selected = p.id; renderPeers(); renderChat(); }).addTo(cars);
  }
}
function renderReports() {
  hazards.clearLayers();
  for (const r of state.reports) {
    if (r.expires < Date.now()) continue;
    const symbol = { hazard: '△', camera: '▣', police: '◇' }[r.type];
    L.marker([r.lat, r.lng], { icon: L.divIcon({ className: 'hazard-marker', html: symbol, iconSize: [30, 30], iconAnchor: [15, 15] }) }).bindPopup(el('span', '', `${r.type === 'camera' ? 'Red-light camera' : r.type === 'police' ? 'Police presence' : 'Road hazard'} · Unverified${state.live ? '' : ' · Demo'}`)).addTo(hazards);
  }
}
function renderChat() {
  const p = state.peers.find(p => p.id === state.selected);
  $('chat-title').textContent = p ? `Hello, ${p.mode === 'ghost' ? 'neighbor' : p.name}` : 'Say hello';
  $('chat-status').textContent = state.live ? 'NEARBY CHAT' : 'DEMO CHAT';
  const fresh = !state.live || Date.now() - state.position.timestamp <= 12000;
  const parked = fresh && state.position.speed !== null && state.position.speed <= .5;
  const signature = JSON.stringify([p,state.messages,parked,state.live,state.id]);
  if (signature === chatSignature) return;
  chatSignature = signature;
  $('chat-hint').textContent = parked ? 'A small gesture goes a long way.' : 'Moving or speed unknown. Quick replies only.';
  $('message').disabled = !p || !parked;
  $('message-form').querySelector('button').disabled = !p || !parked;
  $('message').placeholder = parked ? 'Message while parked…' : 'Quick replies only';
  $('block-driver').disabled = !p;
  const messages = state.messages.filter(m => m.from === p?.id || m.to === p?.id);
  $('messages').replaceChildren(...messages.map(m => {
    const mine = m.from === state.id || m.from === 'demo-you';
    const bubble = el('div', 'bubble' + (mine ? ' mine' : ''));
    bubble.append(el('small', '', mine ? 'YOU' : (m.sender?.name || p?.name || 'Neighbor')), el('span', '', m.text));
    return bubble;
  }));
  $('messages').scrollTop = $('messages').scrollHeight;
  $('flag-message').disabled = !messages.some(m => m.from === p?.id);
  $('quick-replies').replaceChildren(...PHRASES.slice(0, 3).map(text => {
    const b = el('button', '', text); b.disabled = !p; b.onclick = safe(() => send(text)); return b;
  }));
}
function demoTick() {
  state.peers = demoPeers.filter(p => p.distanceFt <= state.profile.radius && !state.blocked.has(p.id));
  state.messages = state.demoMessages.filter(m => Date.now() - m.timestamp < 300000);
  state.reports = state.demoReports.filter(r => r.expires > Date.now());
  renderPeers(); renderChat(); renderReports();
}
async function send(text) {
  if (!state.selected) throw new Error('Select a nearby driver first.');
  if (!text.trim()) return;
  if (!appropriate(text, 240)) throw new Error('Please keep messages friendly and appropriate.');
  if (state.live) await api('messages', 'POST', { to: state.selected, text });
  else state.demoMessages.push({ id: crypto.randomUUID(), from: 'demo-you', to: state.selected, text, timestamp: Date.now() });
  $('message').value = '';
  if (state.live) { state.messages = await api('messages'); renderChat(); } else demoTick();
}
function appropriate(text, max) { return !!text.trim() && text.trim().length <= max && !/[<>\p{Cc}\p{Cf}]/u.test(text) && !/\b(fuck|shit|bitch|asshole|cunt|nigger|faggot)\b/i.test(text.normalize('NFKC')); }
function updateProfile() {
  const active = state.profile.mode === 'active';
  $('mode-label').textContent = active ? 'Active mode' : 'Ghost mode';
  $('nav-profile').textContent = active ? state.profile.name.slice(0,1).toUpperCase() : 'G';
  $('privacy-title').textContent = active ? 'A name. A car. A connection.' : 'You’re a little mysterious.';
  $('privacy-copy').textContent = active ? `${state.profile.name} · ${state.profile.make} ${state.profile.model}. Nearby drivers see this profile when live.` : 'Ghost mode hides your name and car. Your location is shared only in live mode.';
  document.querySelectorAll('[data-radius]').forEach(b => b.classList.toggle('active', Number(b.dataset.radius) === state.profile.radius));
}
function showProfile() {
  const form = $('profile-form'); form.elements.mode.value = state.profile.mode;
  for (const field of ['name','make','model']) form.elements[field].value = state.profile[field];
  $('active-fields').hidden = state.profile.mode !== 'active'; open('profile-dialog');
}
function setView(view) {
  state.view = view; $('list-view').hidden = view !== 'list';
  $('nav-map').classList.toggle('selected', view === 'map'); $('nav-list').classList.toggle('selected', view === 'list');
  if (view === 'map') map.invalidateSize();
}
async function stopLive() {
  window.dispatchEvent(new Event('automaps-stop'));
  state.live = false; state.connecting = false;
  if (state.gpsWatch !== null) navigator.geolocation.clearWatch(state.gpsWatch);
  state.gpsWatch = null;
  const token = state.token; state.token = null; state.id = 'demo-you';
  if (token) { try { await fetch('/api/session', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) }); } catch { /* Presence expires without fresh fixes. */ } }
  state.position = { ...center, accuracy: 1, speed: 0, timestamp: Date.now() };
  map.removeLayer(tiles); demoMap.addTo(map);
  state.start = { ...center, label: 'Demo location' }; state.peers = []; state.messages = []; state.limit = null;
  clearRoute(); state.end = null; updateEndpoints();
  $('connect').textContent = 'Go live ↗'; $('connect').disabled = false;
  $('environment').textContent = 'DEMO DRIVE · SAN FRANCISCO'; $('connection-status').textContent = 'Demo · no location shared';
  $('location-name').textContent = 'The Embarcadero'; $('location-status').textContent = 'San Francisco, CA · Demo location';
  $('speed').textContent = '0'; $('limit').textContent = '25'; $('speed-source').textContent = 'Simulated'; $('accuracy-note').hidden = true;
  map.setView([center.lat + .00009, center.lng - .000025], 21); demoTick();
}
async function startLive() {
  $('live-dialog').close();
  if (!navigator.geolocation) throw new Error('GPS is not available in this browser.');
  state.connecting = true; $('connect').disabled = true; $('connect').textContent = 'Connecting…';
  try {
    await session(); await api('profile', 'PUT', state.profile);
    const fix = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }));
    state.live = true; state.connecting = false; state.peers = []; state.messages = []; state.reports = []; clearRoute(); state.end = null;
    map.removeLayer(demoMap); tiles.addTo(map);
    onGPS(fix);
    state.start = { lat: state.position.lat, lng: state.position.lng, label: 'Current location' }; updateEndpoints();
    state.gpsWatch = navigator.geolocation.watchPosition(onGPS, e => { $('connection-status').textContent = 'GPS interrupted'; toast(e.message); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 });
    $('connect').disabled = false; $('connect').textContent = 'Stop live'; $('environment').textContent = 'LIVE GPS · PRECISE RANGE';
    $('location-name').textContent = 'Your current position'; $('limit').textContent = '—'; $('speed-source').textContent = 'GPS · limit unknown';
    map.setView([state.position.lat, state.position.lng], 19); renderPeers(); renderChat(); renderReports(); await tick();
  } catch(e) { await stopLive(); throw new Error(e.message || 'Location permission is needed for live mode.'); }
}
function onGPS(fix) {
  state.position = { lat: fix.coords.latitude, lng: fix.coords.longitude, accuracy: fix.coords.accuracy, speed: fix.coords.speed === null || fix.coords.speed < 0 ? null : fix.coords.speed, timestamp: fix.timestamp };
  $('speed').textContent = state.position.speed === null ? '—' : Math.round(state.position.speed * 2.23694);
  $('location-status').textContent = `GPS uncertainty ±${Math.round(fix.coords.accuracy * 3.28084)} ft`;
  if (state.lastLimitPosition && map.distance([state.position.lat,state.position.lng], [state.lastLimitPosition.lat,state.lastLimitPosition.lng]) > 30) { state.limit = null; $('limit').textContent = '—'; $('speed-source').textContent = 'GPS · limit unknown'; }
  if (state.route) updateGuidance();
}
async function tick() {
  $('clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (!state.live) { if (!state.connecting) demoTick(); return; }
  if (state.busy) return;
  state.busy = true;
  const activeToken = state.token;
  try {
    if (Date.now() - state.position.timestamp <= 12000) await api('location', 'PUT', state.position);
    const nearby = await api('nearby'); const messages = await api('messages');
    if (!state.live || state.token !== activeToken) return;
    state.peers = nearby.peers; state.reports = nearby.reports; state.messages = messages;
    if (!nearby.locationFresh) { state.limit = null; $('speed').textContent = '—'; $('limit').textContent = '—'; $('speed-source').textContent = 'Waiting for GPS'; }
    $('accuracy-note').hidden = !nearby.accuracyLimited && nearby.locationFresh;
    $('accuracy-note').textContent = nearby.locationFresh ? 'GPS is too imprecise for reliable car-to-car discovery at this range. Waiting for a better fix.' : 'Location is stale. Discovery and chat are paused.';
    $('connection-status').textContent = nearby.locationFresh ? 'Connected · fresh GPS' : 'Waiting for GPS';
    $('scan-label').textContent = `Scanned ${new Date(nearby.scannedAt).toLocaleTimeString([], { minute:'2-digit', second:'2-digit' })} · every 2s`;
    renderPeers(); renderChat(); renderReports();
    if (nearby.locationFresh && state.position.accuracy <= 10 && Date.now() - state.lastLimit > 30000) {
      state.lastLimit = Date.now(); const point = { ...state.position }; const result = await api('speed-limit', 'POST', point);
      if (!state.live || activeToken !== state.token) return;
      state.limit = result.limit; state.lastLimitPosition = point;
      $('limit').textContent = result.limit ? Math.round(result.limit.value * (result.limit.unit === 'km/h' ? .621371 : 1)) : '—';
      $('speed-source').textContent = result.limit ? 'Posted map limit · MPH' : 'GPS · limit unknown';
    }
  } catch (e) { if (state.live) { state.peers = []; state.limit = null; $('limit').textContent = '—'; $('connection-status').textContent = 'Offline · retrying'; $('scan-label').textContent = 'Scan interrupted'; renderPeers(); renderChat(); } }
  finally { state.busy = false; }
}
function updateEndpoints() {
  $('start-name').textContent = state.start.label; $('end-name').textContent = state.end?.label || 'Choose a destination'; $('build-route').disabled = !state.end;
  for (const id of ['apple-link','google-link']) $(id).hidden = !state.end;
  if (state.end) {
    const start = `${state.start.lat},${state.start.lng}`, end = `${state.end.lat},${state.end.lng}`;
    $('apple-link').href = `https://maps.apple.com/?saddr=${encodeURIComponent(start)}&daddr=${encodeURIComponent(end)}&dirflg=d`;
    $('google-link').href = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(start)}&destination=${encodeURIComponent(end)}&travelmode=driving`;
  }
}
function clearRoute() { state.route = null; routeLayer.clearLayers(); $('route-card').hidden = true; document.querySelector('.map-title').hidden = false; }
function updateGuidance() {
  const r = state.route; if (!r) return;
  // Prototype guidance follows route maneuvers; production requires reliable map matching/rerouting.
  const closest = r.steps.map((s,i) => ({ s, i, d: map.distance([state.position.lat,state.position.lng], [s.maneuver.location[1],s.maneuver.location[0]]) })).sort((a,b)=>a.d-b.d)[0];
  if (!closest) return;
  const s = r.steps[Math.min(closest.i + 1, r.steps.length - 1)];
  $('route-title').textContent = `${s.maneuver.type === 'arrive' ? 'Arrive at destination' : `${s.maneuver.modifier || 'Continue'} · ${s.name}`}`;
  $('route-detail').textContent = `${Math.round(r.duration / 60)} min · ${(r.distance / 1609.34).toFixed(1)} mi · No live traffic${state.live ? '' : ' · Demo start'}`;
}
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => $(b.dataset.close).close());
$('nav-map').onclick = () => setView('map'); $('nav-list').onclick = () => setView('list');
$('nav-profile').onclick = showProfile; $('mode-button').onclick = showProfile;
$('nav-report').onclick = $('report-button').onclick = () => open('report-dialog');
$('destination-button').onclick = () => { if (state.live && (state.position.speed === null || state.position.speed > .5)) return toast('Set your route while parked, or use native voice navigation.'); updateEndpoints(); open('route-dialog'); };
$('zoom-in').onclick = () => map.zoomIn(); $('zoom-out').onclick = () => map.zoomOut(); $('recenter').onclick = () => { setView('map'); map.setView([state.position.lat,state.position.lng],21); };
$('connect').onclick = safe(async () => { if (state.live) await stopLive(); else open('live-dialog'); });
$('confirm-live').onclick = safe(startLive);
$('profile-form').onchange = () => $('active-fields').hidden = $('profile-form').elements.mode.value !== 'active';
$('profile-form').onsubmit = safe(async e => {
  e.preventDefault(); const form = e.target; const mode = form.elements.mode.value;
  const next = { ...state.profile, mode, name: '', make: '', model: '' };
  if (mode === 'active') for (const f of ['name','make','model']) { next[f] = form.elements[f].value.trim(); if (!appropriate(next[f], f === 'name' ? 24 : 30)) throw new Error('Enter an appropriate name, make and model.'); }
  if (state.live) await api('profile', 'PUT', next);
  state.profile = next; updateProfile(); $('profile-dialog').close(); toast(mode === 'ghost' ? 'Ghost mode is on. Your identity is hidden.' : 'Active profile saved.');
});
document.querySelectorAll('[data-radius]').forEach(b => b.onclick = safe(async () => {
  const next = { ...state.profile, radius: Number(b.dataset.radius) };
  if (state.live) await api('profile', 'PUT', next);
  state.profile = next; updateProfile(); await tick();
}));
$('message-form').onsubmit = safe(async e => { e.preventDefault(); await send($('message').value); });
$('block-driver').onclick = safe(async () => {
  if (!state.selected) return;
  if (state.live) await api('block', 'POST', { id: state.selected }); else state.blocked.add(state.selected);
  state.selected = null; await tick(); toast('Driver blocked for this session.');
});
$('flag-message').onclick = safe(async () => {
  const m = state.messages.filter(m => m.from === state.selected).at(-1); if (!m) return;
  if (state.live) await api('flag', 'POST', { id: m.id }); else state.blocked.add(state.selected);
  state.selected = null; await tick(); toast('Message flagged; driver blocked. Prototype flags are temporary.');
});
document.querySelectorAll('[data-report]').forEach(b => b.onclick = safe(async () => {
  if (state.live) await api('reports', 'POST', { type: b.dataset.report });
  else state.demoReports.push({ id: crypto.randomUUID(), type: b.dataset.report, ...center, expires: Date.now()+900000 });
  $('report-dialog').close(); await tick(); toast(state.live ? 'Road report shared. Thank you.' : 'Demo report added. Nothing was shared.');
}));
$('search-form').onsubmit = safe(async e => {
  e.preventDefault(); const query = $('place-query').value.trim(); $('search-results').textContent = 'Searching…';
  try {
    const match = query.match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/);
    let results;
    if (match && Math.abs(Number(match[1])) <= 90 && Math.abs(Number(match[2])) <= 180) results = [{ label: query, lat: Number(match[1]), lng: Number(match[2]) }];
    else { await session(); results = await api(`geocode?q=${encodeURIComponent(query)}`); }
    $('search-results').replaceChildren(...results.map(r => {
      const b = el('button', '', r.label); b.onclick = () => { state[$('search-target').value] = r; updateEndpoints(); $('search-results').replaceChildren(); }; return b;
    }));
    if (!results.length) $('search-results').textContent = 'No places found. Try a more specific address.';
  } catch (e) { $('search-results').textContent = e.message; }
});
$('use-location').onclick = () => { state.start = { lat: state.position.lat, lng: state.position.lng, label: state.live ? 'Current position' : 'Demo location' }; updateEndpoints(); };
$('build-route').onclick = safe(async () => {
  if (!state.end) return;
  $('build-route').disabled = true; $('build-route').textContent = 'Finding your route…';
  try {
    await session(); const r = await api('route', 'POST', { start: state.start, end: state.end }); state.route = r;
    routeLayer.clearLayers(); const layer = L.geoJSON(r.geometry, { style: { color: '#4c9474', weight: 7, opacity: .95 } }).addTo(routeLayer);
    map.removeLayer(demoMap); tiles.addTo(map);
    map.fitBounds(layer.getBounds(), { padding: [65,150] }); setView('map'); $('route-card').hidden = false; document.querySelector('.map-title').hidden = true;
    updateGuidance(); $('route-dialog').close();
  } finally { $('build-route').disabled = false; $('build-route').textContent = 'Find driving route ↗'; }
});
$('cancel-route').onclick = clearRoute;
document.addEventListener('visibilitychange', () => { if (document.hidden && state.live) { void stopLive(); toast('Live mode stopped while the browser is in the background.'); } });
window.addEventListener('pagehide', () => { if (state.token) void fetch('/api/session', { method: 'DELETE', headers: { Authorization: `Bearer ${state.token}` }, keepalive: true }); });
updateProfile(); demoTick(); void tick(); setInterval(() => void tick(), 2000);
export { state, api, session, send, toast, open };
