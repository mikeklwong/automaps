import { coordinate, fail } from './domain.mjs';

export class VoiceRooms {
  constructor(store) { this.store=store; this.signals=[]; }
  prune() { this.signals=this.signals.filter(s=>Date.now()-s.created<15000); }
  enable(user, enabled) {
    if (typeof enabled !== 'boolean') fail('Choose a voice state.');
    user.voice=enabled;
    if (!enabled) this.signals=this.signals.filter(s=>s.to!==user.id && s.from!==user.id);
    return {enabled};
  }
  peers(user) {
    if (!user.voice) return [];
    return [...this.store.sessions.values()].filter(p=>p.voice && this.store.eligible(user,p)).map(p=>this.store.public(p));
  }
  send(user, body) {
    this.prune();
    const peer=[...this.store.sessions.values()].find(p=>p.id===body.to);
    if (!user.voice || !peer?.voice || !this.store.eligible(user,peer)) fail('Voice peer is unavailable or outside range.',409);
    if (!['offer','answer','candidate'].includes(body.type)) fail('Invalid voice signal.');
    if (!body.data || typeof body.data !== 'object' || JSON.stringify(body.data).length>24000) fail('Invalid voice payload.');
    if (body.type==='candidate') {
      if (typeof body.data.candidate!=='string' || body.data.candidate.length>2048) fail('Invalid ICE candidate.');
    } else if (body.data.type!==body.type || typeof body.data.sdp!=='string') fail('Invalid session description.');
    if (this.signals.filter(s=>s.from===user.id).length>=80) fail('Too many voice signals.',429);
    this.signals.push({from:user.id,to:peer.id,type:body.type,data:body.data,created:Date.now()});
    return {ok:true};
  }
  poll(user) {
    this.prune();
    const allowed=new Set(this.peers(user).map(p=>p.id));
    const result=this.signals.filter(s=>s.to===user.id && allowed.has(s.from));
    this.signals=this.signals.filter(s=>s.to!==user.id);
    return {peers:this.peers(user),signals:result};
  }
}

const cache=new Map();
export async function weather(point) {
  coordinate(point);
  const lat=Math.round(point.lat*50)/50,lng=Math.round(point.lng*50)/50,key=`${lat},${lng}`;
  const existing=cache.get(key);
  if(existing && Date.now()-existing.fetchedAt<900000) return existing;
  const url=new URL('https://api.open-meteo.com/v1/forecast');
  url.search=new URLSearchParams({latitude:lat,longitude:lng,timezone:'auto',timeformat:'unixtime',forecast_days:'7',temperature_unit:'fahrenheit',wind_speed_unit:'mph',precipitation_unit:'inch',current:'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m',hourly:'temperature_2m,precipitation_probability,visibility,dew_point_2m',daily:'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max,precipitation_sum'});
  const res=await fetch(url,{signal:AbortSignal.timeout(12000)});
  if(!res.ok) fail('Weather provider unavailable. Try again later.',502);
  const data=await res.json();
  if(!data.current || !data.hourly || !data.daily) fail('Weather data incomplete.',502);
  const result={...data,fetchedAt:Date.now(),source:'Open-Meteo',approximateLocation:true};
  if(cache.size>=200) cache.delete(cache.keys().next().value);
  cache.set(key,result);return result;
}
