# T-51 · AV CAPABILITY DOSSIER (measured 2026-10-03, live probes)
| Lane | Endpoint | Hosting | Latency | Verdict |
|------|----------|---------|---------|---------|
| image search | images/search | OSS URL (z-cdn) | ~s | BUILT T-46 |
| image generation | images/generations | signed URL (Expires ≈ +8d), JPEG bytes despite .png | 40–67s | BUILT T-49 |
| report banner | shared fetchBannerLane | same two lanes | — | BUILT T-50 |
| TTS | audio/tts | ✗ RAW BYTES ONLY (SDK returns Response object) | — | HONESTLY BLOCKED — no audio hosting path; data: URI banned by own URL law |
| ASR | audio/asr | base64-in → {text,usage} JSON-out (200 measured; sine-wave → "#" correct-no-speech) | ~s | FEASIBLE — no input consumer today |
| video | video/generation → async-result?id= | hosted MP4 URL (aigc-files.bigmodel.cn) | ~150s (cogvideox-3, speed) | FEASIBLE — deferred pending consumer law (e.g. weekly video brief) |

## Video live artifact (probe of record)
- task: 202610040000110ba6d2b7b93d409e · model cogvideox-3 · PROCESSING→SUCCESS in ~150s (5 polls × 30s)
- url: https://aigc-files.bigmodel.cn/api/cogvideo/83a57e76-bf43-11f1-858c-f21fdb5d8223_0.mp4
- verified: HTTP 200 · video/mp4 · 3,434,630 bytes · ftyp magic True
- measured laws: fps=24 refused (error #1214 "不支持当前fps值") — default fps required; watermark_enabled optional; quality: speed|quality

## Payout-flip pre-check (same round, chain READY)
- claim auto-fires on pending.any (intel decision → claim_reward_balance op, vests toFixed(6), through T-47 PREFLIGHT wall)
- convert self-arms when claimed SBD − 0.5 (reserve) ≥ 1 (MIN) — edge 5504bps ≫ enter 3000bps in-band
- blocked-rate 15% in learning window = historical washout (last blocked 2026-10-02T21:15:40Z, zero today) — no fix needed
