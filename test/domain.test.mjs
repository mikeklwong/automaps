import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, TTL, distance, clean } from '../server/domain.mjs';
import { parseLimit, matchLimit } from '../server/providers.mjs';

function fixture() {
  let now = 1700000000000;
  const store = new Store(() => now);
  const a = store.auth(store.create().token), b = store.auth(store.create().token);
  function locate(u, northMeters = 0, accuracy = .1, speed = 0) {
    store.locate(u, { lat: northMeters / 111195, lng: 0, accuracy, speed, timestamp: now });
  }
  locate(a); locate(b, 2);
  return { store, a, b, locate, advance: ms => now += ms };
}
test('GPS distance handles antimeridian and coincident points', () => {
  assert.equal(distance({lat:0,lng:0},{lat:0,lng:0}),0);
  assert.ok(distance({lat:0,lng:179.999},{lat:0,lng:-179.999}) < 230);
});
test('default is Ghost and public payload contains no car identity or token', () => {
  const { store,a,b } = fixture();
  assert.equal(a.mode,'ghost'); a.name='Private name'; a.make='Private make';
  const peer = store.nearby(b).peers[0];
  assert.match(peer.name,/^Ghost /); assert.equal(peer.make,null); assert.equal(peer.token,undefined);
});
test('Active identity disappears from existing messages after switching to Ghost', () => {
  const {store,a,b} = fixture();
  store.profile(a,{mode:'active',radius:30,name:'Road Friend',make:'Honda',model:'Civic'});
  store.send(a,{to:b.id,text:'Hello'});
  assert.equal(store.inbox(b)[0].sender.name,'Road Friend');
  store.profile(a,{mode:'ghost',radius:30});
  assert.match(store.inbox(b)[0].sender.name,/Ghost/);
  assert.equal(store.inbox(b)[0].sender.make,null);
});
test('both users radius and uncertainty bound are enforced', () => {
  const {store,a,b,locate} = fixture();
  locate(b,5); assert.equal(store.nearby(a).peers.length,1);
  b.radius=10; assert.equal(store.nearby(a).peers.length,0);
  b.radius=30; locate(a,0,5); locate(b,2,5);
  assert.equal(store.nearby(a).peers.length,0); assert.equal(store.nearby(a).accuracyLimited,true);
});
test('stale presence disappears and location data is pruned', () => {
  const {store,a,b,advance} = fixture(); advance(TTL+1);
  assert.equal(store.nearby(a).peers.length,0); assert.equal(b.location,undefined);
  assert.throws(()=>store.send(a,{to:b.id,text:'Hello'}),/outside/);
});
test('chat is scoped to proximity and cannot be sent to arbitrary users', () => {
  const {store,a,b,locate} = fixture(); locate(b,50);
  assert.throws(()=>store.send(a,{to:b.id,text:'Hello'}),/outside/);
  assert.throws(()=>store.send(a,{to:'missing',text:'Hello'}),/outside/);
});
test('moving and unknown speed lock free text but permit quick replies', () => {
  const {store,a,b,locate,advance} = fixture(); locate(a,0,.1,10);
  assert.throws(()=>store.send(a,{to:b.id,text:'typing while driving'}),/quick reply/);
  assert.equal(store.send(a,{to:b.id,text:'Safe travels!'}).text,'Safe travels!');
  advance(2000); locate(a,0,.1,null);
  assert.throws(()=>store.send(a,{to:b.id,text:'unknown speed'}),/quick reply/);
});
test('blocking works bidirectionally for discovery and existing messages', () => {
  const {store,a,b} = fixture(); store.send(a,{to:b.id,text:'Hello'}); store.block(b,a.id);
  assert.equal(store.nearby(a).peers.length,0); assert.equal(store.inbox(b).length,0);
  assert.throws(()=>store.send(a,{to:b.id,text:'Hello'}),/outside/);
});
test('message flagging validates the recipient and blocks sender', () => {
  const {store,a,b}=fixture(); const m=store.send(a,{to:b.id,text:'Hello'});
  assert.throws(()=>store.flag(a,m.id),/not found/); store.flag(b,m.id);
  assert.equal(store.flags.length,1); assert.equal(store.nearby(b).peers.length,0);
});
test('profiles and coordinates reject malformed, unsafe and inappropriate input', () => {
  const {store,a}=fixture();
  assert.throws(()=>clean('<script>'));
  assert.throws(()=>clean('fuck'));
  assert.throws(()=>store.profile(a,{mode:'active',radius:100,name:'Nice',make:'A',model:'B'}));
  assert.throws(()=>store.profile(a,{mode:'active',radius:30,name:'',make:'A',model:'B'}));
  assert.throws(()=>store.locate(a,{lat:91,lng:0}));
  assert.throws(()=>store.locate(a,{lat:0,lng:0,accuracy:-1,timestamp:0,speed:0}));
});
test('reports pin to reporter location, hide identity, enforce cooldown and expiry', () => {
  const {store,a,advance,locate}=fixture();
  store.report(a,{type:'hazard',lat:80,lng:80});
  const r=store.nearby(a).reports[0]; assert.equal(r.lat,0); assert.equal(r.reporter,undefined);
  assert.throws(()=>store.report(a,{type:'police'}),/30 seconds/);
  advance(900001); locate(a); assert.equal(store.nearby(a).reports.length,0);
});
test('messages expire after five minutes and sessions after one hour', () => {
  const {store,a,b,advance}=fixture(); store.send(a,{to:b.id,text:'Hello'});
  advance(300001); assert.equal(store.inbox(b).length,0);
  advance(3600000); store.prune(); assert.equal(store.sessions.size,0);
});
test('speed parsing never interprets conditional or unknown limits as numeric', () => {
  assert.deepEqual(parseLimit('25 mph'),{value:25,unit:'mph'});
  assert.deepEqual(parseLimit('50'),{value:50,unit:'km/h'});
  for (const limit of ['none','signals','50 @ (wet)','walk','0','999']) assert.equal(parseLimit(limit),null);
});
test('road matching refuses ambiguous intersections and directional limits', () => {
  const way = {tags:{maxspeed:'25 mph',name:'Road'},geometry:[{lat:-.01,lon:0},{lat:.01,lon:0}]};
  assert.equal(matchLimit({lat:0,lng:0},[way]).value,25);
  assert.equal(matchLimit({lat:0,lng:0},[way,{...way}]),null);
  assert.equal(matchLimit({lat:0,lng:0},[{...way,tags:{...way.tags,'maxspeed:conditional':'15 @ (school)'}}]),null);
  assert.equal(matchLimit({lat:0,lng:1},[way]),null);
});
