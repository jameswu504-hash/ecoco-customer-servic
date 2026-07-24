# IoT Station Status Sync

The production data path is intentionally split:

- PostgreSQL/Neon: customer knowledge, chat history, RAG chunks, and the cloud copy of station status.
- Azure MySQL: readonly source of truth for station and machine operational state.
- Local sync job: runs from a trusted machine or network that can reach Azure MySQL, then writes the latest station status into PostgreSQL/Neon.
- Render bot: serves LINE/web requests and reads station status from PostgreSQL/Neon.

Render does not need direct Azure MySQL access when the local sync job is running. If Azure firewall blocks Render outbound traffic, that is expected for this architecture.

## Runtime Flow

```text
Customer asks FAQ/SOP/policy question
  -> PostgreSQL knowledge_chunks
  -> RAG context
  -> Claude

Customer asks station/machine question
  -> PostgreSQL RAG still runs
  -> PostgreSQL iot_station_statuses lookup also runs
  -> if Neon has no match, optional MySQL/snapshot fallback is tried
  -> Claude receives both contexts and should prefer iot_station_statuses for status
```

## Local Sync Flow

```text
Trusted local machine
  -> readonly Azure MySQL
  -> npm run iot:sync
  -> PostgreSQL/Neon iot_station_statuses
  -> Render bot reads the synced rows
```

The recommended interval is every 5 minutes. If the local machine is off, the bot still works, but station data stays at the last successful `source_synced_at`.

## PostgreSQL Table

The app creates this table on startup:

```text
iot_station_statuses
```

It stores station code, name, address, area, district, place, longitude, latitude, service hours, station status, machine status, connection status, heartbeat time, alarms, bin capacity, and `source_synced_at`.

## Local Environment Variables

On the trusted machine that can reach Azure MySQL:

```powershell
$env:DATABASE_URL = "<Neon PostgreSQL connection string>"
$env:PGSSL = "require"

$env:ECOCO_IOT_MYSQL_HOST = "<mysql host>"
$env:ECOCO_IOT_MYSQL_PORT = "3306"
$env:ECOCO_IOT_MYSQL_USER = "<readonly user>"
$env:ECOCO_IOT_MYSQL_PASSWORD = "<readonly password>"
$env:ECOCO_IOT_MYSQL_DATABASE = "ecoco"
$env:ECOCO_IOT_MYSQL_SSL_REJECT_UNAUTHORIZED = "false"

npm run iot:sync
```

If the MySQL credentials are in an MCP JSON file, you can use:

```powershell
$env:MCP_CONFIG_PATH = "C:\Users\ACER\Downloads\mcp (1).json"
$env:DATABASE_URL = "<Neon PostgreSQL connection string>"
$env:PGSSL = "require"

npm run iot:sync
```

Do not commit real database credentials.

## Run Every 5 Minutes

Simple PowerShell loop:

```powershell
while ($true) {
  npm run iot:sync
  Start-Sleep -Seconds 300
}
```

For production operations, use Windows Task Scheduler, a small internal VM, or a CI runner that has network access to Azure MySQL.

## Render Environment Variables

Render still needs:

```text
DATABASE_URL=<Neon PostgreSQL connection string>
PGSSL=require
ANTHROPIC_API_KEY=<key>
ADMIN_KEY=<key>
LINE_CHANNEL_SECRET=<key>
LINE_CHANNEL_ACCESS_TOKEN=<key>
```

The `ECOCO_IOT_MYSQL_*` variables are optional on Render after the sync path is enabled. Keeping them set only provides a fallback attempt, but Azure firewall may still block it.

## Verify

After deploying the app and running one successful local sync:

```text
GET /api/system/status
x-admin-key: <ADMIN_KEY>
```

Check:

```json
{
  "database": "ok",
  "iotStationStatusCount": 630,
  "iotStationLastSyncedAt": "2026-07-24T00:00:00.000Z"
}
```

Then ask LINE a station question. The answer should include current station or machine status from the synced PostgreSQL rows. If `iotStationStatusCount` is `0`, run `npm run iot:sync` from a machine that can reach Azure MySQL.
