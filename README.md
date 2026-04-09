# Izipass Backend — v0.1

Fastify REST API powering the Izipass universal bridge.

## What it does

- Routes bridge quotes through LI.FI (best price, fastest path)
- Applies a configurable Izipass fee to every quote
- Builds unsigned transactions for wallet signing — **never holds user funds**
- Tracks bridge execution status with background polling
- Exposes an admin API for fee config, bridge toggles, and monitoring

## Quick start

```bash
npm install
cp .env.example .env          # fill in DATABASE_URL at minimum
npm run dev                   # auto-migrates, seeds, starts on :4000
```

**Docker (recommended for production):**
```bash
cp .env.example .env          # set JWT_SECRET, LIFI_API_KEY, etc.
docker-compose up -d          # starts postgres + redis + api
```

## Startup sequence (automatic)

1. Run Prisma migrations (or `db push` if no history)
2. Seed database — creates admin account, fee config, bridge list
3. Connect Redis (optional — degrades gracefully if unavailable)
4. Start Fastify server
5. Launch status-poller cron (polls LI.FI every 10s for in-flight bridges)

## API routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | — | Health check |
| GET | `/v1/chains` | — | Supported chains |
| GET | `/v1/tokens/:chain` | — | Tokens for a chain |
| POST | `/v1/quote` | — | Get bridge quote |
| POST | `/v1/execute` | — | Build unsigned tx |
| POST | `/v1/execute/:id/tx-hash` | — | Submit signed tx hash |
| GET | `/v1/execute/:id` | — | Get execution status |
| GET | `/v1/history/:address` | — | Wallet tx history |
| POST | `/admin/auth/login` | — | Admin login → JWT |
| GET | `/admin/stats` | JWT | Dashboard stats |
| GET | `/admin/executions` | JWT | All executions |
| GET | `/admin/fees` | JWT | Fee config |
| PUT | `/admin/fees` | JWT | Update fee config |
| GET | `/admin/bridges` | JWT | Bridge list |
| PUT | `/admin/bridges/:name` | JWT | Toggle bridge |

Swagger UI: `http://localhost:4000/docs`

## Environment variables

See `.env.example` — every variable is documented with instructions.
