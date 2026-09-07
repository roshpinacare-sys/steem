# ECOS API Reference — V39

> Base URL: `http://localhost:3000`  
> Auth: `Authorization: Bearer <ECOS_DEPOSIT_API_KEY>` required only for `/deposit`  
> All responses: `Content-Type: application/json`

---

## `POST /api/v1/task`

Submit a task for AI processing through ECOS gate

**Request:**
```json
{"clientAccountId":"client::x","priceUsd":"10.00","rawConfidence":0.85,"aiOutput":{"result":"..."},"taskType":"default"}
```

**Response:**
```json
{"verdict":"HITL_QUEUE","approvalId":"apv_xxx","missionId":"mission_xxx"}
```

---

## `POST /api/v1/chat`

Natural language chat — runs inference internally

**Request:**
```json
{"text":"Review this contract","clientAccountId":"client::x","priceUsd":"1.00"}
```

**Response:**
```json
{"verdict":"HITL_QUEUE","approvalId":"apv_xxx","aiResponse":"AI response text","confidence":null}
```

---

## `GET /api/v1/approvals`

List approvals

**Request:**
```json
?status=pending|approved|all&limit=50
```

**Response:**
```json
{"approvals":[...],"count":5}
```

---

## `POST /api/v1/approvals/:id/resolve`

Resolve an approval (validator decision)

**Request:**
```json
{"validatorAccountId":"validator::x","decision":"approve","note":"Looks good"}
```

**Response:**
```json
{"approval":{...},"receipt":{...}}
```

---

## `POST /api/v1/deposit`

Fund a client account (auth required)

**Request:**
```json
{"clientAccountId":"client::x","amountUsd":"100.00","idempotencyKey":"key-123"}
```

**Response:**
```json
{"credited":"100.00","balanceUsd":"100.0000"}
```

---

## `POST /api/v1/payout`

Withdraw validator earnings to Stripe

**Stripe Key Format:**
`STRIPE_API_KEY` must start with `sk_live_` (production) or `sk_test_` (sandbox). An invalid key format triggers a startup warning but does not prevent server start.

**Request:**
```json
{"validatorAccountId":"validator::x","amountUsd":"40.00"}
```

**Response:**
```json
{"success":true,"payoutId":"po_xxx","mock":true,"remainingBalanceUsd":"0.0000"}
```

---

## `GET /api/v1/account`

Get account balance

**Request:**
```json
?id=client::x
```

**Response:**
```json
{"id":"client::x","balance_micro":"400000","balance_usd":"40.0000"}
```

---

## `GET /api/v1/calibrator`

Calibrator status

**Response:**
```json
{"isReady":true,"fitted":true,"sampleCount":50,"samplesNeeded":0}
```

---

## `POST /api/v1/calibrator/fit`

Fit calibrator with labeled data

**Request:**
```json
{"data":[{"rawScore":0.82,"label":1},...]}
```

**Response:**
```json
{"A":5.17,"B":-3.14,"sampleCount":60,"ready":true}
```

---

## `GET /api/v1/calibrator/training-data`

Fetch training data from DB

**Response:**
```json
{"samples":[...],"count":0}
```

---

## `GET /api/v1/mission/:id`

Full mission detail with audit trail

**Response:**
```json
{"missionId":"...","approvals":[...],"auditTrail":[...],"summary":{...}}
```

---

## `GET /api/v1/stream`

SSE stream for real-time validator updates

**Request:**
```json
?validatorId=validator::x
```

**Response:**
```json
event: approval.created\ndata: {...}
```

---

## `GET /api/v1/verify`

Verify audit log chain integrity

**Response:**
```json
{"ok":true,"length":42}
```

---

## `GET /api/v1/state`

Full ledger state snapshot

**Response:**
```json
{"summary":{...},"accounts":[...],"recentTransactions":[...]}
```

---
