# CHANGELOG V243 — RAG Pipeline + Swarm Planner Integration (Phase P139)

## מה נבנה
- `src/lib/ragPipeline243.js` + `lib/ragPipeline243.js` — RAG pipeline עם chunker, tokenizer, TF-IDF vectorizer, ingest/retrieve/augment.
- `src/lib/swarmPlanner243.js` + `lib/swarmPlanner243.js` — Swarm planner עם plan (skipToolDiscovery path), storage, stats.
- Integration: Swarm + RAG — ingest ואז plan עם retrieved context.

## אימות
- tests/v243.test.js: guard suite מלא, כולל SACRED md5, server wiring, §1-§4.

## הערה (V503)
קובץ זה שוחזר ב-V503 לאחר שאוחסן בשגגה ב-_archive_orphans_v497/.
הטסט tests/v243.test.js מצפה לקיומו — realFail → pass.
