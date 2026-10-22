# API contract

All JSON mutations require `Content-Type: application/json`; all endpoints except session creation, config and health require `Authorization: Bearer TOKEN`. Tokens are issued to anonymous sessions, not verified accounts. Keep them private and use HTTPS. The API rejects foreign browser origins and caps bodies at 4 KB. Errors are `{ "error": "Human-readable message" }`.

| Method | Path | Body / result |
|---|---|---|
| POST | `/api/session` | `{}` → `{token,id,alias,expires}`; one-hour session |
| DELETE | `/api/session` | Removes current session immediately |
| GET | `/api/config` | Quick replies and scan/presence timings |
| GET | `/api/health` | `{ok,version}` |
| PUT | `/api/profile` | `{mode:"ghost"|"active",name,make,model,radius:10|20|30}` |
| PUT | `/api/location` | `{lat,lng,accuracy,speed,timestamp}`; meters, m/s or null, Unix ms |
| GET | `/api/nearby` | `{peers,reports,scannedAt,locationFresh,accuracyLimited}` |
| POST | `/api/messages` | `{to:peerId,text}`; 240 characters; receiver must still be in range |
| GET | `/api/messages` | Last five minutes of this session's messages, excluding blocked users |
| POST | `/api/block` | `{id:peerId}`; mutual exclusion for discovery and chat |
| POST | `/api/flag` | `{id:receivedMessageId}`; adds temporary flag and blocks sender |
| POST | `/api/reports` | `{type:"hazard"|"camera"|"police"}`; fresh GPS required |
| GET | `/api/geocode?q=...` | Up to five explicitly requested place results |
| POST | `/api/route` | `{start:{lat,lng},end:{lat,lng}}` → GeoJSON route, steps, duration, distance |
| POST | `/api/speed-limit` | `{lat,lng}` → `{limit:null|{value,unit,road,source},...}` |
| POST | `/api/weather` | `{lat,lng}` → cached Open-Meteo current/hourly/daily forecast; rounded coordinates |
| PUT | `/api/voice` | `{enabled:boolean}`; explicit voice opt-in/disable |
| GET | `/api/voice` | `{peers,signals}`; consumes queued signals from eligible opted-in peers |
| POST | `/api/voice/signal` | `{to,type:"offer"|"answer"|"candidate",data}`; authenticated proximity-checked signaling |

Presence submission and nearby queries are separate. Clients poll every two seconds without overlapping requests and upload only fresh fixes. Fix timestamps outside ±12 seconds are rejected. Coordinates and speed are client claims; no hardware attestation exists.

`GET /api/nearby` contains no session tokens. Peer details are projected according to their current mode; Ghost returns no make/model. Reports omit their author. `GET /api/messages` similarly projects current sender identity, so switching to Ghost removes active metadata on the next read (it cannot erase data a recipient already saw or recorded).

Limits: 240 API requests/minute per socket IP, 10 new sessions/minute per IP, at most 5,000 concurrent sessions, one message/1.5 seconds/session, one road report/30 seconds/session. These are prototype limits, not distributed abuse protection. Behind a reverse proxy, socket-IP limiting aggregates clients; add trusted gateway limits before deployment. No client-controlled forwarded IP header is trusted.

Memory-only data is lost on restart. Run one instance for development. Multiple instances require a shared presence store and expiry semantics, such as Redis TTLs and geospatial indexing, plus durable moderated reports if desired. Do not deploy this in-memory prototype as a production service.

Voice signaling has a 32 KB request limit (24 KB maximum signal data), expires after 15 seconds, and is capped at 80 queued signals per sender. Microphone media travels over WebRTC, not these HTTP endpoints. The default ICE configuration is empty; configure appropriate STUN/TURN servers for cross-network voice. Signaling eligibility is rechecked at both submission and delivery. Client connections close on expiry, disable, loss of proximity or blocking, but hard media revocation against modified clients requires a production SFU/relay.
