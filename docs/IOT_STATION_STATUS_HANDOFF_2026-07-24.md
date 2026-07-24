# IoT Station Status Handoff - 2026-07-24

## Current Status

Station and machine status lookup is implemented and deployed.

Confirmed production state:

- Render service is live.
- Neon/PostgreSQL contains synced IoT station status rows.
- `/api/system/status` reports `iotStationStatusCount` around `701`.
- Local Windows Task Scheduler runs the sync every 5 minutes.
- LINE/web station replies use the synced Neon data.
- Customer replies do not show data sync timestamps.

## Production Architecture

Customer reply path:

```text
LINE / web customer question
  -> Render Express app
  -> PostgreSQL RAG knowledge lookup
  -> PostgreSQL iot_station_statuses lookup for station/machine questions
  -> deterministic station-status reply when station rows are found
```

Sync path:

```text
Trusted local Windows machine
  -> readonly Azure MySQL
  -> npm run iot:sync
  -> Render admin sync API
  -> Neon/PostgreSQL iot_station_statuses
```

Render does not need direct Azure MySQL access for normal production station replies. Azure firewall blocking Render MySQL connections is expected unless a separate fallback path is intentionally allowed.

## Sync Job

Current local setup:

```text
Task Scheduler name: ECOCO IoT Station Sync
Interval: every 5 minutes
Script: .local-iot-sync/run-once.ps1
Logs: .local-iot-sync/logs/iot-sync-*.log
```

The local runner uses:

- `MCP_CONFIG_PATH` for readonly Azure MySQL credentials.
- `ECOCO_IOT_SYNC_URL` for the Render admin sync endpoint.
- encrypted local `ADMIN_KEY` storage scoped to the current Windows user.

Do not commit `.local-iot-sync/`. It is local runtime state and may contain encrypted secrets/logs.

## Data Model

Table:

```text
iot_station_statuses
```

Primary key:

```text
(station_code, asset_id)
```

Reason: one station can have multiple machine assets. The MySQL query may return duplicate station rows, so the sync job dedupes by `(station_code, asset_id)` and keeps the freshest row.

Typical sync result:

```text
Fetched from MySQL: 752 rows
Written to PostgreSQL after dedupe: 701 rows
```

## Customer Reply Style

When station rows are found, the app returns a deterministic Traditional Chinese reply instead of asking Claude to invent or interpret the status.

Required customer-facing structure:

```text
Friendly greeting that says the station was found

Station display name
Address line

Status section
Machine status line
Connection status line

Bin capacity section
Bin 1 line: remaining, current, limit
Bin 2 line: remaining, current, limit, plus a full-bin note when remaining is 0

Short guidance to report through the App or support form if the on-site status differs
```

Do not show customer-facing freshness metadata, including:

- `source_synced_at`
- `iotStationLastSyncedAt`
- raw ISO timestamps such as `2026-07-24T08:52:41.093Z`
- any customer-facing "data sync time" label

Freshness fields are admin-only diagnostics.

## Admin Verification

System status:

```text
GET /api/system/status
x-admin-key: <ADMIN_KEY>
```

Check:

- `database = ok`
- `iotStationStatusCount > 0`
- `iotStationLastSyncedAt` is recent

Station search:

```text
GET /api/iot/station-statuses/search?q=es0140&limit=10
x-admin-key: <ADMIN_KEY>
```

Expected for `es0140`:

- a Tainan Xiaobei Ximen store station record is returned
- machine status is normal/up
- connection status is normal/online
- bin capacity fields are present
- multiple rows may exist when the station has multiple assets

Production chat smoke test:

```text
POST /api/chat
Content-Type: application/json

{"message":"es0140 station status","sessionId":"smoke-iot-es0140"}
```

Expected:

- response is formatted with line breaks
- response contains station address, machine status, connection status, and bin capacities
- response does not contain raw sync timestamps

## Troubleshooting

If customer station answers do not use IoT data:

1. Check whether the question contains a station name or code such as `es0140`.
2. Check `/api/iot/station-statuses/search?q=<station>` with admin key.
3. Check `/api/system/status` for `iotStationStatusCount` and `iotStationLastSyncedAt`.
4. Check Task Scheduler task `ECOCO IoT Station Sync`.
5. Check `.local-iot-sync/logs/iot-sync-*.log` on the sync machine.
6. Run `npm run iot:sync` manually from a machine that can reach Azure MySQL.

If Render logs show `Live station context lookup error: connect ETIMEDOUT`, first check whether Neon still has fresh station rows. Render direct MySQL timeout is not the main production path.

## Important Commits

- `cfbbbc8` - sync IoT station data through PostgreSQL
- `a2d1789` - add admin IoT sync upload endpoint
- `e802205` - store station assets separately with `(station_code, asset_id)`
- `009f29c` - reply directly with synced station status
- `2290f5a` - route station code questions to IoT lookup
- `7589ba8` - hide station sync timestamp from customer replies
- `3f7d03e` - polish station status reply formatting
