# Barrel Drop Inventory (MVP)

Lean inventory management app for Barrel Drop with a lightweight Svelte UI, Express API, and MongoDB.

## Features
- Role-based access (admin/user)
- Item catalog with freeze/unfreeze
- Stock receipts with required invoice upload
- S3-backed invoice uploads with presigned URLs (optional)
- FIFO inventory consumption on sales
- Sales report (per user) and admin profit/loss
- User management (admin)
- Mobile SKU barcode scanning (device support required)
- Bulk CSV import for items

## Local Setup (Docker)
1. `docker compose up --build`
2. Frontend: `http://localhost:5173`
3. API health: `http://localhost:4000/health`

## First Run
- Use the login screen to create the initial admin (Bootstrap).
- Then log in and add items, stock receipts, and sales.

## Environment
API env example in `api/.env.example`.

Session config (optional env vars):

- `SESSION_TTL_HOURS` — auth session lifetime in hours (default 8)

Rate limit config (optional env vars):

- `RATE_LIMIT_WINDOW_MS` — window in ms (default 900000 = 15m)
- `AUTH_RATE_LIMIT_MAX` — max attempts for auth endpoints (default 10)
- `FORGOT_RATE_LIMIT_MAX` — max for forgot/reset endpoints (default 5)
- `DEFAULT_RATE_LIMIT_MAX` — default max for protected endpoints (default 100)

Audit logging:

- Audit entries are saved to the `AuditLog` collection and include actor, action, target, IP, and user agent.
- Admins can view recent logs via `GET /audit` (admin-only). Supports cursor pagination via `limit` and `cursor` (opaque base64), `direction` (`next` / `prev`), and optional `start` / `end` date filters (ISO or `YYYY-MM-DD`, end is inclusive).

- Collections with larger datasets support cursor pagination: `GET /items`, `GET /users`, `GET /sales`, and `GET /stock-receipts` return `{ items|users|sales|receipts, nextCursor, prevCursor, limit, hasMore }` and accept `limit`, `cursor`, and `direction` parameters. Sales also supports `start`/`end` (inclusive end) to restrict by `soldAt`.
- `GET /items` also supports `q` for server-side name/SKU search (used by the Sales item picker).

## Notes
- Invoice uploads are stored on the API container filesystem under `api/uploads`.
- For production (ECS), map `uploads` to persistent storage (EFS or S3) and set `COOKIE_SECURE=true`.
- To enable S3 uploads, set `AWS_REGION` and `S3_BUCKET` (task role or access keys are required).
- Ensure the S3 bucket allows CORS `PUT` from your frontend origin.
