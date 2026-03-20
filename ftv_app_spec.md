# Syncrofy FTV Data Generator — App Requirements Spec

## Purpose

This app supports internal dogfooding of the Syncrofy FTV (File Transfer Visibility) platform. It generates realistic file transfer event data, submits it to a live Syncrofy instance, and provides a web interface for facilitators to manage scenarios and for participants to receive their briefings and tasks.

The goal: people sit down with the Syncrofy UI, work through realistic scenarios, and provide feedback on the product experience.

---

## Architecture

- **Single Next.js app** deployed on Vercel
- **TypeScript throughout** — the Python data generator must be rewritten in TypeScript
- **Server-side API routes** handle data generation and submission to Syncrofy (API key never exposed to client)
- **No database required** — scenario state (frozen data, answer keys) can be held in-memory or in Vercel KV/Edge Config if persistence across deploys is needed. Start simple.

---

## Two Views

### `/admin` — Facilitator View

The person running the dogfooding session. This view provides:

1. **Scenario dashboard** — all 8 scenarios listed with:
   - Scenario number and name
   - Short description (the "situation" from the scenario briefs)
   - Current status: `Not run` / `Submitted` / `Drip in progress` / `Frozen`
   - Target date selector (what date the generated data should use)

2. **Trigger controls** per scenario:
   - **"Generate & Submit"** button — generates the scenario data, POSTs it to Syncrofy, computes and displays the answer key
   - **"Freeze"** toggle — locks the current generated data so re-triggering doesn't overwrite it. When frozen, the trigger button is disabled and the answer key stays stable. Facilitator can unfreeze to re-run.
   - **"Generate & Drip"** button — generates data, then drip-feeds events to Syncrofy at their realistic scheduled times (see Drip Mode below)

3. **Answer key** per scenario (expandable/collapsible):
   - Auto-generated from the actual data that was submitted
   - Shows the specific transfers that are "the answer" — the failures, anomalies, or items the participant should find
   - For each answer transfer: filename, partner, timestamp, what happened (failure type, error message), and what the participant should conclude
   - Example for Scenario 4: "settlement_20260320_005.dat from Meridian Capital — staging failure at 3:42 PM ET. Error: 'Staging area full: /staging/meridian/outbound — disk space exceeded'. Participant should identify this as the missing 5th settlement file."

4. **Bulk controls:**
   - "Generate full day" — runs the standard daily traffic generator (no scenario injection) for a target date
   - "Generate week" — runs 5 consecutive weekdays
   - Date picker for all bulk operations

### `/scenarios` — Participant View

The person doing the dogfooding exercise. Clean, focused, no admin controls.

1. **Scenario list** — shows only scenarios that the facilitator has triggered (status is not `Not run`)
2. **Each scenario card shows:**
   - Scenario name
   - Persona name and role (e.g., "David Chen — Senior File Transfer Analyst")
   - The situation narrative (what's happening, why you're looking at Syncrofy)
   - The task list (what you need to find/do/verify)
3. **Does NOT show:** answer keys, generated data details, admin controls, other scenarios' internal data
4. **No ability to trigger scenarios** — that's facilitator-only

---

## Syncrofy Submission

### Endpoint

Default: `https://events.prod.syncrofy.com:443`

Configurable via `SYNCROFY_ENDPOINT` environment variable. The docs also list:
- `https://nginx-api.prod.syncrofy.com:443/events/`
- `https://52.118.189.238:443/events/`

### Authentication

API key stored in `SYNCROFY_API_KEY` environment variable (Vercel env var, never exposed to client).

**Auth header format: TBD.** The user will provide the exact header format (likely `Authorization: Bearer <key>` or `X-API-Key: <key>`). Build it so the header name is also configurable via `SYNCROFY_AUTH_HEADER` env var, defaulting to `Authorization` with value `Bearer <key>`. This way it's easy to change without a code update.

### Payload Format

Each POST sends a JSON array of events for a single transfer (one ARRIVEDFILE_KEY). The array contains 3–15 events depending on the transfer pattern.

```
POST /events/ HTTP/1.1
Content-Type: application/json

[
  { "STAGE": "ARRIVED_FILE", "Event": "StartTransfer", ... },
  { "STAGE": "PROCESSING", "Event": "PROCESSING", ... },
  { "STAGE": "DELIVERY", "Event": "StartedDelivery", ... },
  ...
]
```

### Batch Considerations

The docs say: keep batches under 1,000 events and 1 MB. Each transfer is well under this. For bulk submission (full day = 300-400 transfers), submit them sequentially with a small delay (50-100ms) between POSTs to avoid overwhelming the endpoint. Implement basic retry logic (3 retries with exponential backoff) for failed POSTs.

### Drip Mode

When the facilitator clicks "Generate & Drip":

1. Generate all transfers for the scenario/day upfront
2. Sort all transfers by their StartTransfer TIME
3. **Drip individual events, not whole transfers** — this means StartTransfer appears in Syncrofy, then 2 seconds later the ProcessDetails shows up, then processing steps, then delivery, etc. The Syncrofy UI will show the transfer progressing in real time.
4. If the server starts dripping at 10 AM but some transfers have timestamps from 8 AM, flush all "past" events immediately, then drip future events on schedule
5. The drip process runs server-side. The facilitator dashboard should show progress (e.g., "142/355 transfers submitted, next event at 2:34 PM")

**Implementation note:** Drip mode on Vercel serverless functions has a max execution time (typically 10-60 seconds). Options:
- Use Vercel Cron Jobs to wake up periodically and submit the next batch of due events
- Use a long-running WebSocket or SSE connection from the admin page that drives the timing client-side, calling API routes to submit each event
- Use Vercel's Edge Functions with streaming

Pick the approach that's most reliable on Vercel. If none work cleanly, document the limitation and provide a local-run alternative (`npm run drip`).

---

## Event Schema

All events follow the Syncrofy FTV event schema documented at: https://docs.prod.syncrofy.com/en/ftv/ftv_events

### Event Types

| Stage | Event | Required | Purpose |
|-------|-------|----------|---------|
| ARRIVED_FILE | StartTransfer | Yes | Initiates transfer, includes sender info |
| ARRIVED_FILE | ProcessDetails | Optional | Details about received file (ZIP, PGP layers) |
| PROCESSING | PROCESSING | Optional | Intermediate steps (checksum, normalize, virus scan) |
| DELIVERY | StartedDelivery | Yes (for delivery) | Delivery begins, includes consumer info |
| DELIVERY | ProcessDetails | Optional | Delivery-specific processing |
| DELIVERY | CompleteDelivery | Yes (for success) | File successfully delivered |
| DELIVERY | FailedDelivery | For failures | Delivery failed with error message |
| ARRIVED_FILE | CompleteTransfer | Yes (for success) | Marks entire transfer complete |
| ARRIVED_FILE | FailTransfer | For failures | Marks entire transfer failed |

### Key Rules

- All events for the same transfer share an `ARRIVEDFILE_KEY`
- `ARRIVEDFILE_KEY` format: `YYYYMMDDHHMMSSFFFFFFNNN` (timestamp + 6-digit fractional + 3-digit sequence)
- `EVENT_KEY` = `ARRIVEDFILE_KEY` for receive/processing events
- `EVENT_KEY` = unique key for each delivery attempt (different from ARRIVEDFILE_KEY)
- `TIME` = Unix millisecond timestamp as a string
- `EVENT_SOURCE_NAME/URL/TYPE` identifies the gateway node (alternate between two nodes for realism)
- `Direction`: `inbound` (from partner) or `outbound` (to partner)
- `Status`: `Unknown`, `Success`, `Failed`, `Retry`, `InProgress`
- `ProducerProtocol` valid values: `AS2`, `SFTP`, `FTP`, `FTPS`, `HTTP`, `HTTPS`, `CD`, `MBX`, `Mailbox`, `DB`, `FS`, `Bus`, `AWS`, `Email`, `API`, `RN`, `OFTP`, `Other`
- `ProducerPattern`: `PUSH` (remote initiated) or `PULL` (gateway initiated)
- `LayerType` values: `ZIP`, `PGP`, `Normalize Data`, `Generate Checksum`, `Validate Checksum`, `Store Checksum`, `Add to Archive`, `Validate Archive`, `Virus Scan`
- `LayerStatus`: `Success` or `Failed`

---

## Simulated Environment

### Organization: Pinnacle National Bank

Mid-size US commercial bank with two SFG production nodes.

**Event source nodes (alternate between these for realism):**

| Name | URL | Type |
|------|-----|------|
| Pinnacle SFG Prod Node 1 | http://sfg-prod-01.pinnaclenb.com | SFG |
| Pinnacle SFG Prod Node 2 | http://sfg-prod-02.pinnaclenb.com | SFG |

**Pick one node per transfer and use it consistently across all events in that transfer.**

### Partners (Inbound)

| Partner | Protocol | Pattern | Direction | Remote Host | Port | User ID | Volume/Day | PGP | File Types |
|---------|----------|---------|-----------|-------------|------|---------|------------|-----|------------|
| Meridian Capital Group | SFTP | PUSH | inbound | 10.42.88.15 | 22 | meridian_sftp | 150–200 | Yes | settlement_YYYYMMDD_NNN.dat (70%), position_YYYYMMDD.dat (30%) |
| Lakeshore Clearing | CD | PUSH | inbound | 10.55.12.100 | 1364 | lakeshore_cd | 20–40 | No | margin_call_YYYYMMDD_NNN.dat (60%), collateral_YYYYMMDD.dat (40%) |
| Evergreen Insurance Co. | HTTP | PUSH | inbound | 10.88.33.22 | 443 | evergreen_api | 60–80 | No | claims_BBBB_YYYYMMDD.json (BBBB = batch counter) |
| Atlas Payroll Services | SFTP | PULL | inbound | 10.66.200.8 | 22 | atlas_payroll | 30–50 | No | payroll_batch_YYYYMMDD.csv |
| John Deere Financial | SFTP | PUSH | inbound | 10.77.44.30 | 22 | jdeere_loan_ops | 10–20 | Yes | loan_pkg_NNNN.zip.pgp (NNNN = incrementing ID) |

### Partner (Outbound)

| Partner | Protocol | Pattern | Direction | Remote Host | Port | User ID | Volume/Day | PGP | File Types |
|---------|----------|---------|-----------|-------------|------|---------|------------|-----|------------|
| Federal Reserve (FedLine) | FTPS | PUSH | outbound | reg-reporting.pinnaclenb.com | 22 | pinnacle_reg_svc | 5–15 | No | reg_call_report_YYYYMMDD.dat, reg_fr2900_YYYYMMDD.dat, reg_ffiec009_YYYYMMDD.dat |

**Note on FedLine (outbound):** Pinnacle originates these files internally. The StartTransfer `ProducerXxx` fields reflect an internal Pinnacle system (reg-reporting.pinnaclenb.com), not an external partner. The file is then delivered outbound to FedLine.

### Delivery Destinations (ConsumerXxx fields)

| Destination Key | Name | Protocol | Host | Port | User ID | Path |
|-----------------|------|----------|------|------|---------|------|
| treasury | Pinnacle Treasury App | SFTP | sftp-treasury.pinnaclenb.com | 22 | treasury_svc | /Treasury/Inbox |
| operations | Pinnacle Operations | SFTP | sftp-ops.pinnaclenb.com | 22 | ops_svc | /Operations/Inbox |
| lending | Pinnacle Lending System | SFTP | sftp-lending.pinnaclenb.com | 22 | lending_svc | /Lending/Inbox |
| claims | Pinnacle Claims Processing | HTTP | claims-api.pinnaclenb.com | 443 | claims_svc | /api/claims/ingest |
| payroll | Pinnacle Payroll System | SFTP | sftp-payroll.pinnaclenb.com | 22 | payroll_svc | /Payroll/Inbox |
| fedline | FedLine Submission | FTPS | fedline-submit.frb.gov | 990 | pinnacle_fed | /Submissions/Inbox |

### Partner → Destination Routing

| Partner | Default Destination |
|---------|-------------------|
| Meridian Capital Group | treasury |
| Lakeshore Clearing | treasury |
| Evergreen Insurance Co. | claims |
| Atlas Payroll Services | payroll |
| John Deere Financial | lending |
| Federal Reserve (FedLine) | fedline |

---

## Transfer Patterns

### Pattern 1: Happy Path (Full Success) — ~85% of transfers

```
StartTransfer (SUCCESS) →
  ProcessDetails (ZIP/PGP if applicable) →
  PROCESSING steps (2–5 random: Normalize, Checksum Gen, Checksum Validate, Virus Scan, Archive, etc.) →
  StartedDelivery → CompleteDelivery (5–30 sec gap) →
  CompleteTransfer
```

- TIME gaps: 1–3 seconds between processing events, 5–30 seconds for delivery
- Not all transfers need every processing step — vary randomly

### Pattern 2: Retry Then Success — ~5% of transfers

```
StartTransfer (Retry) →
  [processing steps] →
  StartedDelivery → FailedDelivery (error) →
  [60–300 second gap] →
  StartedDelivery (new EVENT_KEY) → CompleteDelivery →
  CompleteTransfer
```

- FailedDelivery errors: "Connection timeout", "Connection refused", "Remote host not responding" (vary randomly)
- The retry delivery gets a NEW EVENT_KEY (different delivery attempt)

### Pattern 3: PGP Decrypt Failure

```
StartTransfer (SUCCESS) →
  ProcessDetails (ZIP, if applicable) →
  PROCESSING (PGP, Failed, "Decrypt failed: invalid key") →
  FailTransfer ("Processing failure: PGP decrypt")
```

- Only applies to PGP-encrypted partners: Meridian Capital, John Deere
- Variant error: "Decrypt failed: corrupted input data" (used in Scenario 2 for one Meridian failure)

### Pattern 4: Staging/Delivery Failure

```
StartTransfer (SUCCESS) →
  [processing steps] →
  StartedDelivery → FailedDelivery ("Staging area full: /staging/{partner}/outbound — disk space exceeded") →
  FailTransfer ("Delivery failed: staging error")
```

### Pattern 5: Partial File Received

```
StartTransfer (SUCCESS, ProducerFileSize: expected_size) →
  ProcessDetails (Validate Checksum) →
  FailTransfer ("Partial file received: expected {X} bytes, received {Y} bytes")
```

- No delivery events — never made it past receive stage
- Y should be 20–50% of X

### Pattern 6: Virus Scan Failure

```
StartTransfer (SUCCESS) →
  ProcessDetails (ZIP) → ProcessDetails (PGP) →
  PROCESSING (Virus Scan, Failed, "Threat detected: Trojan.GenericKD") →
  FailTransfer ("File quarantined — virus scan failure")
```

### Pattern 7: Stalled Transfer

```
StartTransfer (InProgress) →
  ProcessDetails (one step)
```

- No further events. Transfer appears in-progress indefinitely.
- The TIME on the last event should be 2+ hours before "now" to look stalled

### Pattern 8: Slow Delivery

```
StartTransfer (SUCCESS) →
  [processing steps] →
  StartedDelivery → [45-minute gap] → CompleteDelivery →
  CompleteTransfer
```

- Normal delivery takes 5–30 seconds. This takes 45 minutes.

---

## Volume and Timing

### Daily Volume

Per-partner ranges (see partner table above) sum to roughly 275–405 transfers/day.

### Success/Failure Distribution (for generic day generation)

- ~85% full success (Pattern 1)
- ~5% retry then success (Pattern 2)
- ~5% various failures (Patterns 3–6, mixed)
- ~3% slow but successful (Pattern 8)
- ~2% stalled or ambiguous (Pattern 7)

### Time Distribution

All times are Eastern Time. Transfers spread across 6:00 AM – 8:00 PM with weighted peaks:

| Window | Weight | Notes |
|--------|--------|-------|
| 9:00–10:00 AM | Highest | Market open |
| 12:00–1:00 PM | High | Midday batch |
| 3:30–5:00 PM | High | EOD settlement concentration |
| 6:00–8:00 AM | Medium | Pre-market |
| Other hours | Low | Background trickle |

Weekend days: ~40% of weekday volume, more evenly distributed.

---

## Scenarios

### Scenario 1: Monday Morning Triage

**Persona:** David Chen — Senior File Transfer Analyst at Pinnacle National Bank

**Situation:** It's Monday morning. David needs to review weekend transfer activity and identify anything that needs immediate attention.

**Data to generate:** 2 days (Saturday + Sunday preceding the target date)
- ~400 total transfers
- ~350 fully successful
- ~25 retry-then-success
- Injected failures:
  - 1 staging failure from Lakeshore Clearing
  - 1 partial file from Meridian Capital
  - 1 delivery failure to Evergreen Insurance
  - 1 stalled transfer from Atlas Payroll (Pattern 7 — 2+ hours old)

**Tasks for participant:**
1. Review the weekend activity. How many transfers ran? How many succeeded vs. failed?
2. Identify the failed transfers. What went wrong with each?
3. Prioritize: which failure needs attention first and why?
4. Is there anything still in progress that shouldn't be?

**Answer key should show:** The 4 injected failures with exact filenames, timestamps, error messages, and partners.

---

### Scenario 2: PGP Key Rotation Fallout

**Persona:** David Chen — Senior File Transfer Analyst

**Situation:** It's Friday morning. The security team rotated PGP keys last night. David needs to check if the rotation caused any issues.

**Data to generate:** 1 morning (target date, 6 AM – 12 PM)
- Normal successful traffic from all partners
- 8–12 PGP decrypt failures from Meridian Capital (Pattern 3, "invalid key")
  - 1 of these with variant error: "Decrypt failed: corrupted input data"
- 4–6 PGP decrypt failures from John Deere Financial (Pattern 3, "invalid key")
- Failures spread across the morning, not clustered

**Tasks for participant:**
1. Are there any transfer failures this morning? How many and from which partners?
2. What's the common error? What's the root cause?
3. Is there an outlier — a failure with a different error message? What might explain it?
4. Which partners are unaffected? Why?

**Answer key should show:** All PGP failures with exact counts per partner, the one "corrupted input data" outlier, and which partners (Evergreen, Atlas, Lakeshore, FedLine) had zero failures because they don't use PGP.

---

### Scenario 3: New Partner Onboarding

**Persona:** David Chen — Senior File Transfer Analyst

**Situation:** Lakeshore Clearing was onboarded as a new partner last week. David is doing a health check on their transfer activity.

**Data to generate:** 1 full day
- 8–10 Lakeshore Clearing transfers (all CD protocol)
  - 6–7 fully successful
  - 1 misrouted — delivered to `/Operations/Inbox` (operations destination) instead of `/Treasury/Inbox` (treasury destination). This is a subtle misconfiguration.
  - 1 slow delivery (Pattern 8, 45-minute delivery time)
- Normal background traffic from all other partners

**Tasks for participant:**
1. How many transfers came from Lakeshore today? Were they all successful?
2. Look at the delivery details — are all files going to the right place?
3. Are the transfer speeds normal? Is anything unusually slow?
4. Based on your findings, is this partner "healthy" or are there issues to address?

**Answer key should show:** The misrouted transfer (wrong ConsumerPath) and the slow delivery (45-min gap), with exact filenames and timestamps.

---

### Scenario 4: Where's the Settlement File?

**Persona:** David Chen — Senior File Transfer Analyst

**Situation:** It's mid-afternoon. The Treasury team calls — they received settlement files 001 through 004 from Meridian Capital but not 005. They need it by EOD for reconciliation.

**Data to generate:** 1 afternoon (12 PM – 5 PM)
- 4 successful Meridian settlement files: settlement_YYYYMMDD_001.dat through _004.dat
- 1 failed Meridian settlement file: settlement_YYYYMMDD_005.dat — staging failure (Pattern 4)
- Normal background traffic from other partners

**Tasks for participant:**
1. Find settlement file 005. Is it in the system?
2. What happened to it? Where did it fail?
3. What's the error message? What does it tell you about root cause?
4. What would you tell the Treasury team?

**Answer key should show:** settlement_YYYYMMDD_005.dat with staging failure details, error message, and timestamp.

---

### Scenario 5: End-of-Quarter Regulatory Batch

**Persona:** David Chen — Senior File Transfer Analyst

**Situation:** It's end of quarter. Pinnacle must submit 12 regulatory files to the Federal Reserve by 5 PM. David is monitoring the batch.

**Data to generate:** 1 afternoon (1 PM – 5 PM)
- 12 regulatory files to FedLine: 4x reg_call_report, 4x reg_fr2900, 4x reg_ffiec009
- 9 complete successfully (spread 1–4 PM)
- 1 retry-then-success (Pattern 2, "delivery timeout" first attempt)
- 1 permanent failure: FailedDelivery with "Remote endpoint rejected: invalid submission format"
- 1 late arrival (not generated until 4:15 PM, completes by 4:30 PM)
- Normal background traffic from other partners

**Tasks for participant:**
1. How many of the 12 regulatory files have been submitted successfully?
2. Which file(s) failed? What's the error?
3. Is there a file that arrived late? When?
4. It's 4:45 PM — what's the status? Can Pinnacle meet the 5 PM deadline?

**Answer key should show:** The permanently failed file (name, error), the retry file (name, both attempts), and the late file (name, 4:15 PM start time).

---

### Scenario 6: Did You Receive Our File?

**Persona:** Karen Mitchell — External User at John Deere Financial

**Situation:** Karen sent loan_pkg_4471.zip.pgp to Pinnacle at 9:15 AM. Her internal team wants confirmation it was received. She logs into the Syncrofy portal with John Deere credentials.

**Data to generate:** 1 full day
- loan_pkg_4471.zip.pgp from John Deere at 9:15 AM — fully successful (complete event chain)
- 2–3 other successful John Deere transfers for context
- Normal background traffic from all other partners

**Tasks for participant:**
1. Log into the portal. Find loan_pkg_4471.zip.pgp.
2. Was it received successfully? What status do you see?
3. Can you confirm when it was received and verify the file size?
4. Write a one-sentence confirmation to your internal team.

**Answer key should show:** loan_pkg_4471.zip.pgp with full event chain timestamps, file size, and final status.

**UX learning goals:** Does the external user view provide enough info? Are labels meaningful to non-bank users? Can Karen find her file without seeing data she doesn't need?

---

### Scenario 7: Why Was My File Rejected?

**Persona:** Karen Mitchell — External User at John Deere Financial

**Situation:** John Deere sent several loan packages today. One (loan_pkg_4502.zip.pgp) was rejected. Karen needs to understand why.

**Data to generate:** 1 full day
- 8–10 successful John Deere transfers
- 1 failed: loan_pkg_4502.zip.pgp — virus scan failure (Pattern 6)
- Normal background traffic from all other partners

**Tasks for participant:**
1. Find the rejected file. What's the status?
2. What reason is given for the rejection?
3. Is the error message understandable to someone outside the bank?
4. What would you tell your internal team at John Deere?

**Answer key should show:** loan_pkg_4502.zip.pgp with virus scan failure details, error message, and timestamp.

---

### Scenario 8: The Same Failure, Three Perspectives

**Persona:** Multiple (this scenario is used to compare how different users experience the same event)

**Situation:** loan_pkg_4488.zip.pgp from John Deere failed — partial file received (expected 245,000 bytes, got 112,000 bytes).

**Data to generate:** 1 full day of normal traffic + 1 injected failure
- Full day of standard traffic from all partners (with normal failure distribution)
- 1 additional failure: loan_pkg_4488.zip.pgp — partial file (Pattern 5, expected=245000, received=112000)

**Tasks for participant:**
1. Find the failed transfer.
2. What information do you see about the failure?
3. (This scenario is run by 3 different people to compare their experience)

**Answer key should show:** loan_pkg_4488.zip.pgp with partial file details (expected vs received bytes, timestamp, error message).

---

## Auto-Generated Answer Key Format

When a scenario is triggered, the generator should track which transfers are "the answer" (the injected failures/anomalies) separately from background traffic. The answer key should be a structured object like:

```typescript
interface AnswerKey {
  scenarioId: number;
  scenarioName: string;
  generatedAt: string; // ISO timestamp
  targetDate: string; // YYYY-MM-DD
  totalTransfers: number;
  totalSuccess: number;
  totalFailed: number;
  totalStalled: number;
  findings: Finding[];
}

interface Finding {
  description: string; // Human-readable: "Missing settlement file — staging failure"
  arrivedfileKey: string;
  filename: string;
  partner: string;
  startTime: string; // Human-readable ET timestamp
  outcome: string; // "FailTransfer" | "Stalled" | "Misrouted" | "Slow delivery"
  errorMessage?: string;
  details: string; // Longer explanation of what happened and what participant should conclude
}
```

The facilitator view renders this as a clear, scannable list.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SYNCROFY_API_KEY` | Yes | API key for Syncrofy event endpoint |
| `SYNCROFY_ENDPOINT` | No | Event endpoint URL (default: `https://events.prod.syncrofy.com:443`) |
| `SYNCROFY_AUTH_HEADER` | No | Auth header name (default: `Authorization`). Value sent as `Bearer <key>` unless the key itself contains the full header value. |

---

## Open Items (Need Resolution Before or During Build)

1. **Auth header format** — user is confirming exact header format for Syncrofy API. Currently defaulting to `Authorization: Bearer <key>`. May need to change.
2. **Drip mode on Vercel** — serverless function timeout limits may make true drip-feed difficult. Evaluate options (Vercel Cron, client-driven SSE, Edge Functions) and pick the most reliable. Document any limitations. Fallback: provide `npm run drip` for local execution.
3. **State persistence** — if the facilitator freezes a scenario, the answer key and generated data need to survive across page refreshes. Vercel KV, Edge Config, or even a JSON file in `/tmp` (ephemeral but survives within a single serverless instance) are options. Start simple; upgrade if needed.

---

## Reference Implementation

A working Python implementation of the data generator exists at `ftv_generator.py` (provided alongside this spec). It covers all 8 patterns, all 8 scenarios, partner/destination configuration, time distribution, and volume scaling. **Rewrite the generation logic in TypeScript** — the Python version is the reference for correct event schemas, key generation, timing, and scenario-specific data injection.

Key things the Python implementation gets right that must be preserved:
- ARRIVEDFILE_KEY format: `YYYYMMDDHHMMSSFFFFFFNNN`
- Event source node is picked once per transfer and reused across all events
- Processing steps vary randomly (2–5 steps from the available set, in logical order)
- Delivery EVENT_KEY is different from ARRIVEDFILE_KEY
- Weekend volume is 40% of weekday
- Time distribution uses weighted hour buckets with peaks at market open, midday, and EOD
