import {open, toast} from './app.js';

// Display presets are layout choices, not claims about a vehicle's permissions.
const profiles = {standard:'Phone / desktop', wide:'Wide EV display', compact:'Compact EV display', portrait:'Portrait EV display'};
const el = (tag, text) => { const node=document.createElement(tag); if(text)node.textContent=text; return node; };
let saved='standard';
try { saved=localStorage.getItem('automaps.display')||saved; } catch {}
const requested=new URLSearchParams(location.search).get('display');
let profile=Object.hasOwn(profiles,requested)?requested:Object.hasOwn(profiles,saved)?saved:'standard';
const button=el('button','▤ Display');button.id='vehicle-display';button.setAttribute('aria-label','Vehicle display settings');
document.querySelector('.rail-links').append(button);
const dialog=el('dialog');dialog.id='vehicle-dialog';
dialog.innerHTML=`<div class="dialog-head"><div><span class="eyebrow">AT HOME ON YOUR SCREEN</span><h2>Vehicle display</h2></div><button id="close-vehicle" aria-label="Close vehicle settings">×</button></div>
<p>For parked use in a compatible vehicle browser. A display preset does not unlock driving access, vehicle sensors, or microphone permissions.</p>
<label>Screen layout<select id="vehicle-profile"></select></label>
<div class="vehicle-options"><button id="vehicle-fullscreen" class="secondary">Enter full screen</button><button id="vehicle-refresh" class="secondary">Refresh compatibility check</button></div>
<h3>This browser</h3><dl id="vehicle-capabilities"></dl>
<p class="fine-print">“Available” means an API exists, not that hardware access is granted. Use Go live to request location and Enable voice to request the microphone. This check requests neither.</p>
<h3>When something is unavailable</h3><p>Keep using demo maps or route search. For live proximity or voice, open this same server on your phone while parked and grant access there. Your phone is a separate participant; this display is not paired to it.</p>
<label>Open on another device<input id="vehicle-address" readonly aria-label="App address for another device"></label><p id="vehicle-address-note" class="fine-print"></p>`;
document.body.append(dialog);
const select=document.getElementById('vehicle-profile');
for(const [value,label] of Object.entries(profiles)){const option=el('option',label);option.value=value;select.append(option);}
const banner=el('div');banner.id='vehicle-banner';banner.innerHTML='<strong>Parked display</strong><span>Browser access depends on your vehicle. No vehicle telemetry connected.</span>';
document.querySelector('main').prepend(banner);
function apply(){
  document.documentElement.dataset.display=profile;select.value=profile;banner.hidden=profile==='standard';
  try{localStorage.setItem('automaps.display',profile);}catch{}
  // Leaflet observes window resize; presets can change its container without resizing the window.
  requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));
}
let checkVersion=0;
async function inspect(){
  const version=++checkVersion;
  const rows=[['Secure context',isSecureContext?'Yes':'No — deploy with HTTPS'],['Location API',navigator.geolocation?'Available; permission and GPS fix required':'Unavailable — use a phone'],['Microphone API',navigator.mediaDevices?.getUserMedia?'Available; permission required':'Unavailable — use a phone'],['WebRTC audio',window.RTCPeerConnection?'Available; connectivity untested':'Unavailable — voice cannot connect'],['Network',navigator.onLine?'Online hint; service reachability untested':'Offline'],['Full screen',document.fullscreenEnabled?'Available':'Not exposed by this browser']];
  for(const name of ['geolocation','microphone']){
    try{const status=await navigator.permissions.query({name});rows.push([`${name==='geolocation'?'Location':'Microphone'} permission`,status.state]);}catch{rows.push([`${name==='geolocation'?'Location':'Microphone'} permission`,'Not queryable; use the explicit feature control']);}
  }
  if(version!==checkVersion)return;
  const list=document.getElementById('vehicle-capabilities');list.replaceChildren();
  for(const [label,value] of rows)list.append(el('dt',label),el('dd',value));
  document.getElementById('vehicle-fullscreen').disabled=!document.fullscreenEnabled;
  const local=['localhost','127.0.0.1','[::1]'].includes(location.hostname);
  document.getElementById('vehicle-address').value=local?'Deploy to your own HTTPS address first':`${location.origin}/`;
  document.getElementById('vehicle-address-note').textContent=local?'A localhost address on this computer cannot be opened from the vehicle or phone.':'Only the server address is shown. No identity, session token or precise location is included.';
}
select.onchange=()=>{profile=select.value;const url=new URL(location.href);url.searchParams.set('display',profile);history.replaceState(null,'',url);apply();};
button.onclick=()=>{open('vehicle-dialog');void inspect();};
document.getElementById('close-vehicle').onclick=()=>dialog.close();
document.getElementById('vehicle-refresh').onclick=inspect;
document.getElementById('vehicle-fullscreen').onclick=async()=>{
  try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}
  catch{toast('Full screen is unavailable or blocked by this vehicle.');}
};
document.addEventListener('fullscreenchange',()=>{document.getElementById('vehicle-fullscreen').textContent=document.fullscreenElement?'Exit full screen':'Enter full screen';});
for(const event of ['online','offline'])window.addEventListener(event,()=>{if(dialog.open)void inspect();});
apply();
