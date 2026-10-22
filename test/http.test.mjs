import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server/index.mjs';

test('HTTP API: auth, presence, chat, revocation, origin and static security', async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const req = async (path, method='GET', body, token) => {
    const r=await fetch(base+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});
    return {status:r.status, data:await r.json()};
  };
  assert.equal((await req('/api/nearby')).status,401);
  const a=(await req('/api/session','POST',{})).data, b=(await req('/api/session','POST',{})).data;
  for (const user of [a,b]) assert.equal((await req('/api/location','PUT',{lat:0,lng:0,accuracy:.1,speed:0,timestamp:Date.now()},user.token)).status,200);
  assert.equal((await req('/api/nearby','GET',undefined,a.token)).data.peers.length,1);
  assert.equal((await req('/api/messages','POST',{to:b.id,text:'Hello, neighbor'},a.token)).status,201);
  assert.equal((await req('/api/messages','GET',undefined,b.token)).data.length,1);
  assert.equal((await req('/api/session','DELETE',undefined,b.token)).status,200);
  assert.equal((await req('/api/nearby','GET',undefined,b.token)).status,401);
  const foreign=await fetch(base+'/api/session',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'});
  assert.equal(foreign.status,403);
  const home=await fetch(base); assert.equal(home.status,200); assert.match(await home.text(),/Automaps/);
  assert.match(home.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.equal((await fetch(base+'/%2e%2e%5cpackage.json')).status,404);
  assert.equal((await req('/api/location','PUT',{lat:'bad'},a.token)).status,400);
});
