import {state,api,session,send,toast,open} from './app.js';
const $=id=>document.getElementById(id);
const element=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls||'';if(text!==undefined)e.textContent=text;return e;};
const guarded=fn=>async(...args)=>{try{await fn(...args);}catch(e){toast(e.message);}};
const colors={green:'#b7ec79',blue:'#8cbbff',red:'#ff9898',purple:'#c8a0ff',pink:'#ffa8d5',cyan:'#83e4e8',yellow:'#f4df7e',white:'#edf4f3'};
let settings={appearance:'dark',accent:'green',volume:65,unit:'f'};
try{settings={...settings,...JSON.parse(localStorage.getItem('automaps.preferences')||'{}')};}catch{}
function save(){try{localStorage.setItem('automaps.preferences',JSON.stringify(settings));}catch{}}
const rail=element('div','extra-nav');
rail.innerHTML='<button id="quick-tab" aria-label="Quick Chat"><span>☏</span><small>Quick Chat</small></button><button id="weather-tab" aria-label="Weather forecast"><span>☀</span><small>Weather</small></button><button id="settings-tab" aria-label="Settings"><span>⚙</span><small>Settings</small></button>';
document.querySelector('.rail-links').append(rail);
const voicePanel=element('section','voice-panel');
voicePanel.innerHTML='<div class="voice-head"><span class="eyebrow">PROXIMITY VOICE</span><span id="voice-count">OFF</span></div><div class="voice-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><p id="voice-status">Your road, on the same wavelength.</p><div class="voice-buttons"><button id="voice-toggle">Enable voice</button><button id="voice-mute" disabled>Mic muted</button></div><label class="voice-volume">Voice volume <input id="voice-volume" type="range" min="0" max="100" value="65" aria-label="Voice playback volume"><output id="volume-value">65%</output></label>';
document.querySelector('.chat-section').after(voicePanel);
const weatherChip=element('button','weather-chip');weatherChip.id='weather-chip';weatherChip.innerHTML='<span>☀</span><div><strong>Weather on your way</strong><small>Tap for local forecast ↗</small></div>';
document.querySelector('.map-shell').append(weatherChip);
const dialogs=element('div');
dialogs.innerHTML=`
<dialog id="settings-dialog"><div class="dialog-head"><div><span class="eyebrow">MAKE IT YOURS</span><h2>A little more you.</h2></div><button data-dismiss="settings-dialog" aria-label="Close settings">×</button></div>
<div class="settings-tabs"><button data-pane="appearance" class="active">Appearance</button><button data-pane="sound">Sound</button><button data-pane="preferences">Preferences</button></div>
<section id="pane-appearance"><h3>Color theme</h3><p>Set the mood for your next mile.</p><div id="color-options" class="color-options"></div><h3>Day & night</h3><div class="appearance-options"><button data-appearance="dark">☾ Dark</button><button data-appearance="light">☀ Light</button><button data-appearance="auto">◐ Automatic</button></div><p class="fine-print">Automatic follows your device’s light/dark preference, including its scheduled changes.</p></section>
<section id="pane-sound" hidden><h3>Your cabin, your balance.</h3><p>Voice volume changes nearby conversation audio only. Your music app keeps its own volume control.</p><label>Voice playback volume <input id="settings-volume" type="range" min="0" max="100" value="65"></label><button id="settings-mute" class="secondary">Toggle microphone mute</button><button id="disable-voice" class="danger-button">Disable voice chat entirely</button><p class="fine-print">Disable stops microphone tracks and closes incoming and outgoing voice connections. Voice starts off on every visit.</p></section>
<section id="pane-preferences" hidden><h3>The little details.</h3><label>Weather temperature<select id="temperature-unit"><option value="f">Fahrenheit · °F</option><option value="c">Celsius · °C</option></select></label><button id="quiet-mode" class="secondary">Quiet cabin · mute mic and all voice playback</button><button id="reset-preferences" class="secondary">Restore green dark theme & default volume</button><p class="fine-print">Only appearance and volume preferences are saved on this device. Identity, location and chat are not saved in browser storage.</p></section></dialog>
<dialog id="quick-dialog"><div class="dialog-head"><div><span class="eyebrow">GOOD VIBES. ONE TAP.</span><h2>Quick Chat</h2></div><button data-dismiss="quick-dialog" aria-label="Close Quick Chat">×</button></div><p id="quick-recipient"></p><div id="quick-grid" class="quick-grid"></div><p class="fine-print">Messages go only to the selected driver while they are within your confirmed radius. Demo sends stay on this device.</p></dialog>
<dialog id="voice-dialog"><div class="dialog-head"><div><span class="eyebrow">THE OPEN CHANNEL</span><h2>Say hello to your road.</h2></div><button data-dismiss="voice-dialog" aria-label="Close voice consent">×</button></div><p>Enable two-way voice with nearby drivers who also opt in. Your microphone starts muted. Unmute to let all connected nearby participants hear you; they may already be speaking.</p><p>Audio uses encrypted WebRTC connections. It is not recorded by Automaps, but other participants could record it. Peer connections can reveal network addresses. Configure TURN for reliable connectivity across mobile networks.</p><p class="fine-print">This browser feature is for parked testing. Native CarPlay voice integration is not yet available. Disable voice at any time to stop microphone capture and disconnect everyone.</p><button id="join-voice" class="primary">Enable voice · microphone starts muted</button></dialog>
<dialog id="weather-dialog" class="weather-dialog"><div class="dialog-head"><div><span class="eyebrow">KNOW WHAT’S AHEAD</span><h2>Your weather window.</h2></div><button data-dismiss="weather-dialog" aria-label="Close weather">×</button></div><div id="weather-content"><p>Load the public forecast for the viewed area. We send rounded coordinates to Open-Meteo; demo mode uses San Francisco.</p></div><button id="refresh-weather" class="primary">Load forecast</button><p class="fine-print"><a href="https://open-meteo.com/" target="_blank" rel="noopener">Weather data by Open-Meteo</a> · Forecast estimates, not road-condition or emergency alerts. Cached for 15 minutes.</p></dialog>`;
document.body.append(dialogs);
document.querySelectorAll('[data-dismiss]').forEach(b=>b.onclick=()=>$(b.dataset.dismiss).close());
$('settings-tab').onclick=()=>open('settings-dialog');
$('weather-tab').onclick=weatherChip.onclick=()=>open('weather-dialog');
document.querySelectorAll('[data-pane]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-pane]').forEach(x=>x.classList.toggle('active',x===b));for(const name of ['appearance','sound','preferences'])$('pane-'+name).hidden=b.dataset.pane!==name;});
for(const [name,color] of Object.entries(colors)){const b=element('button','swatch',name);b.style.setProperty('--swatch',color);b.dataset.color=name;b.onclick=()=>{settings.accent=name;applyTheme();};$('color-options').append(b);}
const systemTheme=matchMedia('(prefers-color-scheme: light)');
function applyTheme(){
  if(!colors[settings.accent])settings.accent='green';
  if(!['dark','light','auto'].includes(settings.appearance))settings.appearance='dark';
  document.documentElement.dataset.theme=settings.appearance==='auto'?(systemTheme.matches?'light':'dark'):settings.appearance;
  document.documentElement.style.setProperty('--lime',colors[settings.accent]);
  document.querySelectorAll('[data-color]').forEach(b=>{b.classList.toggle('active',b.dataset.color===settings.accent);b.setAttribute('aria-pressed',String(b.dataset.color===settings.accent));});
  document.querySelectorAll('[data-appearance]').forEach(b=>b.classList.toggle('active',b.dataset.appearance===settings.appearance));save();
}
document.querySelectorAll('[data-appearance]').forEach(b=>b.onclick=()=>{settings.appearance=b.dataset.appearance;applyTheme();});
systemTheme.addEventListener('change',applyTheme);applyTheme();
let phrases=['Nice car! 👍','Hello, neighbor! 👋','Thank you! 🙌','After you! 🤝','Drive safe! 💚','Your lights are off.','Your trunk is open.','Your tire looks low.','Please keep some distance.','Hazard ahead.','Enjoy the drive! ☀️'];
$('quick-tab').onclick=()=>{const peer=state.peers.find(p=>p.id===state.selected);$('quick-recipient').textContent=peer?`To ${peer.name} · ${peer.distanceFt} ft away`:'Select a nearby driver first.';$('quick-grid').replaceChildren(...phrases.map(text=>{const b=element('button','',text);b.disabled=!peer;b.onclick=guarded(async()=>{if(state.selected!==peer?.id||!state.peers.some(p=>p.id===peer.id))throw new Error('This driver left your selection or range. Reopen Quick Chat.');await send(text);$('quick-dialog').close();toast('Quick Chat sent.');});return b;}));open('quick-dialog');};

let enabled=false,muted=true,stream=null,epoch=0,polling=false,iceServers=[],lastVoiceSuccess=0;
const connections=new Map();
function updateVoice(){
  $('voice-toggle').textContent=enabled?'Disable voice':'Enable voice';$('voice-mute').disabled=!enabled;
  $('voice-mute').textContent=muted?'Unmute mic':'Mute mic';$('voice-mute').classList.toggle('transmitting',enabled&&!muted);
  const connected=[...connections.values()].filter(c=>c.pc.connectionState==='connected').length;
  $('voice-count').textContent=enabled?`${connected} CONNECTED`:'OFF';
  $('voice-status').textContent=!enabled?'Your road, on the same wavelength.':muted?'Listening · your microphone is muted.':'Microphone live · nearby participants can hear you.';
  voicePanel.classList.toggle('voice-active',enabled);voicePanel.classList.toggle('mic-live',enabled&&!muted);
}
function setMuted(value){muted=value;stream?.getAudioTracks().forEach(t=>t.enabled=!muted);updateVoice();}
function volume(value){settings.volume=Math.max(0,Math.min(100,Number(value)||0));for(const c of connections.values())c.audio.volume=settings.volume/100;for(const id of ['voice-volume','settings-volume'])$(id).value=settings.volume;$('volume-value').textContent=settings.volume+'%';save();}
$('voice-volume').oninput=$('settings-volume').oninput=e=>volume(e.target.value);volume(settings.volume);
function drop(id){const c=connections.get(id);if(!c)return;c.pc.close();c.audio.srcObject=null;c.audio.remove();connections.delete(id);updateVoice();}
async function disable(){epoch++;enabled=false;stream?.getTracks().forEach(t=>t.stop());stream=null;for(const id of [...connections.keys()])drop(id);setMuted(true);try{if(state.token)await api('voice','PUT',{enabled:false});}catch{}updateVoice();}
$('voice-toggle').onclick=()=>enabled?void disable():open('voice-dialog');
$('voice-mute').onclick=$('settings-mute').onclick=()=>{if(enabled)setMuted(!muted);else toast('Enable voice first.');};
$('disable-voice').onclick=()=>{void disable();toast('Voice chat disabled. Microphone released.');};
$('quiet-mode').onclick=()=>{setMuted(true);volume(0);toast('Quiet cabin on.');};
window.addEventListener('automaps-stop',()=>void disable());
document.addEventListener('visibilitychange',()=>{if(document.hidden)void disable();});
window.addEventListener('pagehide',()=>{stream?.getTracks().forEach(t=>t.stop());for(const c of connections.values())c.pc.close();});
$('join-voice').onclick=guarded(async()=>{
  $('voice-dialog').close();if(!state.live)throw new Error('Connect live GPS first. Voice needs real nearby participants.');
  if(!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection)throw new Error('This browser needs HTTPS and WebRTC microphone support.');
  const version=++epoch;$('voice-toggle').disabled=true;
  try{
    const config=await api('config');iceServers=config.iceServers||[];
    const media=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
    if(version!==epoch||!state.live){media.getTracks().forEach(t=>t.stop());return;}
    stream=media;muted=true;stream.getAudioTracks().forEach(t=>t.enabled=false);
    await api('voice','PUT',{enabled:true});if(version!==epoch||!state.live){await disable();return;}
    enabled=true;lastVoiceSuccess=Date.now();updateVoice();await voicePoll();
  }catch(e){await disable();throw e;}finally{$('voice-toggle').disabled=false;}
});
function connection(id){
  if(connections.has(id))return connections.get(id);
  const pc=new RTCPeerConnection({iceServers}),audio=new Audio();audio.autoplay=true;audio.volume=settings.volume/100;audio.setAttribute('playsinline','');audio.hidden=true;document.body.append(audio);
  const c={pc,audio,pending:[],created:Date.now()};connections.set(id,c);
  stream.getTracks().forEach(t=>pc.addTrack(t,stream));
  pc.onicecandidate=e=>{if(e.candidate&&enabled)api('voice/signal','POST',{to:id,type:'candidate',data:e.candidate.toJSON()}).catch(()=>{});};
  pc.ontrack=e=>{audio.srcObject=e.streams[0]||new MediaStream([e.track]);audio.play().catch(()=>toast('Audio playback blocked. Tap Enable voice again to reconnect.'));};
  pc.onconnectionstatechange=()=>{if(['failed','closed'].includes(pc.connectionState))drop(id);else updateVoice();};
  return c;
}
async function voicePoll(){
  if(!enabled||polling)return;
  if(!state.live||Date.now()-state.position.timestamp>12000){await disable();return;}
  polling=true;const version=epoch;
  try{
    const data=await api('voice');if(!enabled||version!==epoch)return;lastVoiceSuccess=Date.now();
    const ids=new Set(data.peers.map(p=>p.id));for(const id of [...connections.keys()])if(!ids.has(id))drop(id);
    for(const signal of data.signals){
      if(!ids.has(signal.from))continue;const c=connection(signal.from);
      if(signal.type==='candidate'){if(c.pc.remoteDescription)await c.pc.addIceCandidate(signal.data);else c.pending.push(signal.data);}
      else{
        await c.pc.setRemoteDescription(signal.data);for(const candidate of c.pending)await c.pc.addIceCandidate(candidate);c.pending=[];
        if(signal.type==='offer'){await c.pc.setLocalDescription(await c.pc.createAnswer());await api('voice/signal','POST',{to:signal.from,type:'answer',data:c.pc.localDescription.toJSON()});}
      }
    }
    for(const peer of data.peers){
      if(connections.has(peer.id)||state.id.localeCompare(peer.id)>0)continue;
      const c=connection(peer.id);await c.pc.setLocalDescription(await c.pc.createOffer());await api('voice/signal','POST',{to:peer.id,type:'offer',data:c.pc.localDescription.toJSON()});
    }
    for(const [id,c] of connections)if(c.pc.connectionState!=='connected'&&Date.now()-c.created>20000){drop(id);toast('Voice could not connect. A TURN relay may be required on this network.');}
    updateVoice();
  }catch(e){if(Date.now()-lastVoiceSuccess>5000)await disable();else $('voice-status').textContent='Voice connection interrupted…';}
  finally{polling=false;}
}
setInterval(()=>void voicePoll(),2000);
setInterval(()=>{if(enabled&&(Date.now()-lastVoiceSuccess>6000||!state.live))void disable();},1000);
updateVoice();

let forecast=null;
const temperature=v=>Number.isFinite(v)?Math.round(settings.unit==='c'?(v-32)*5/9:v)+'°':'—';
function weatherName(code){if(code===0)return 'Clear skies';if(code<=3)return 'Partly cloudy';if(code<=48)return 'Foggy';if(code<=67)return 'Rain';if(code<=77)return 'Snow';if(code<=82)return 'Rain showers';if(code<=86)return 'Snow showers';return 'Thunderstorms';}
function renderWeather(){
  if(!forecast)return;const c=forecast.current,h=forecast.hourly,d=forecast.daily;
  const index=Math.max(0,h.time.findLastIndex(t=>t<=c.time));
  const container=$('weather-content');container.replaceChildren();
  const hero=element('div','weather-hero');hero.append(element('span','weather-symbol',c.is_day?'☀':'☾'),element('strong','',temperature(c.temperature_2m)),element('div','',weatherName(c.weather_code)));container.append(hero);
  container.append(element('p','weather-locality',`${forecast.areaLabel} · Feels like ${temperature(c.apparent_temperature)} · ${new Date(c.time*1000).toLocaleString([], {timeZone:forecast.timezone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}`));
  const grid=element('div','weather-metrics');
  const format=(v,suffix)=>Number.isFinite(v)?`${Math.round(v)}${suffix}`:'—';
  for(const [label,value] of [['Humidity',format(c.relative_humidity_2m,'%')],['Rain chance · hour',format(h.precipitation_probability[index],'%')],['Visibility',Number.isFinite(h.visibility[index])?(h.visibility[index]/1609.34).toFixed(1)+' mi':'—'],['Wind',format(c.wind_speed_10m,' mph')],['Gusts',format(c.wind_gusts_10m,' mph')],['Pressure',format(c.pressure_msl,' hPa')],['Dew point',temperature(h.dew_point_2m[index])],['UV max · today',format(d.uv_index_max[0],'')]]){const card=element('div');card.append(element('span','',label),element('strong','',value));grid.append(card);}container.append(grid);
  if((h.visibility[index]??Infinity)<1000)container.append(element('p','weather-caution','Low visibility forecast. Allow extra time and follow actual road conditions.'));
  container.append(element('h3','','The next seven days'));
  const days=element('div','forecast-days');d.time.forEach((t,i)=>{const row=element('div','forecast-day');row.append(element('strong','',i===0?'Today':new Date(t*1000).toLocaleDateString([],{timeZone:forecast.timezone,weekday:'short'})),element('span','',weatherName(d.weather_code[i])),element('span','',`${temperature(d.temperature_2m_max[i])} / ${temperature(d.temperature_2m_min[i])}`),element('small','',format(d.precipitation_probability_max[i],'% rain')));days.append(row);});container.append(days);
  const time=t=>new Date(t*1000).toLocaleTimeString([],{timeZone:forecast.timezone,hour:'numeric',minute:'2-digit'});
  container.append(element('p','fine-print',`Sunrise ${time(d.sunrise[0])} · Sunset ${time(d.sunset[0])} · Retrieved ${new Date(forecast.fetchedAt).toLocaleTimeString()}`));
  weatherChip.replaceChildren(element('span','',c.is_day?'☀':'☾'));const label=element('div');label.append(element('strong','',`${temperature(c.temperature_2m)} · ${weatherName(c.weather_code)}`),element('small','',`${format(c.relative_humidity_2m,'% humidity')} · View forecast ↗`));weatherChip.append(label);
}
$('refresh-weather').onclick=guarded(async()=>{
  $('refresh-weather').disabled=true;$('refresh-weather').textContent='Checking the skies…';
  try{await session();const point={lat:state.position.lat,lng:state.position.lng};const areaLabel=state.live?'Near your position at lookup':'San Francisco · demo area';forecast=await api('weather','POST',point);forecast.areaLabel=areaLabel;renderWeather();}
  finally{$('refresh-weather').disabled=false;$('refresh-weather').textContent='Refresh forecast';}
});
$('temperature-unit').value=settings.unit;
$('temperature-unit').onchange=e=>{settings.unit=e.target.value;save();renderWeather();};
$('reset-preferences').onclick=()=>{settings={appearance:'dark',accent:'green',volume:65,unit:'f'};applyTheme();volume(65);$('temperature-unit').value='f';renderWeather();toast('Default preferences restored.');};
