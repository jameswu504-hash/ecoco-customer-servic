# Live IoT MySQL Integration

This project can keep two data paths separate:

- PostgreSQL knowledge: stable FAQ, SOP, policy, response rules, and RAG chunks.
- MySQL IoT: live station and machine state such as address, opening hours, online/offline status, bin capacity, alarm code, and heartbeat time.

The app does not copy all MySQL rows into PostgreSQL. When a user asks a station or machine question, the chat flow performs a readonly MySQL lookup and appends the result to the Claude context for that one reply.

## Render Environment Variables

Set these on the Render Web Service:

```text
ECOCO_IOT_MYSQL_HOST=<mysql host>
ECOCO_IOT_MYSQL_PORT=3306
ECOCO_IOT_MYSQL_USER=<readonly user>
ECOCO_IOT_MYSQL_PASSWORD=<readonly password>
ECOCO_IOT_MYSQL_DATABASE=ecoco
ECOCO_IOT_MYSQL_SSL=true
ECOCO_IOT_MYSQL_SSL_REJECT_UNAUTHORIZED=true
ECOCO_IOT_MYSQL_CONNECTION_LIMIT=4
ECOCO_IOT_MYSQL_CONNECT_TIMEOUT_MS=10000
```

Keep the MySQL user readonly. Do not commit real passwords to Git.

## Runtime Flow

```text
Customer asks FAQ/SOP/policy question
  -> PostgreSQL knowledge_chunks
  -> RAG context
  -> Claude

Customer asks station/machine question
  -> PostgreSQL RAG still runs
  -> readonly MySQL stations/machines lookup also runs
  -> Claude receives both contexts and should prefer live MySQL for status
```

## Tables Used

The live lookup currently reads:

- `stations`
- `machines`
- `areas`
- `districts`
- `places`

It selects only station/machine operational fields. It does not read member, phone, email, password, or token fields.

## How To Verify

After deploy, open the admin-only status endpoint:

```text
GET /api/system/status
x-admin-key: <ADMIN_KEY>
```

Check:

```json
{
  "liveMysqlIotEnabled": true
}
```

To test the actual MySQL network connection without using the Render Shell:

```text
GET /api/system/status?check_iot=true
x-admin-key: <ADMIN_KEY>
```

Check:

```json
{
  "liveMysqlIotConnection": {
    "configured": true,
    "ok": true
  }
}
```

If `ok` is `false` and `errorCode` is `ETIMEDOUT`, the app is enabled but Azure MySQL is not reachable from Render. In that case, add the Render outbound IPs or a static outbound IP to the Azure MySQL firewall allowlist.

Then ask a station question such as:

```text
小北百貨台南西門店站現在正常嗎？
```

The answer should use live status, connection, alarm, bin, and heartbeat data when a matching station is found.
