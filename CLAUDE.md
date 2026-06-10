# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`smile_works_app_backend` is a Node.js/Express REST API backend for a dental clinic management system. It uses MongoDB (via Mongoose) and JWT-based authentication.

## Commands

**Run the server:**
```bash
node app.js
```

**Run with human-readable logs (development):**
```bash
node app.js | npx pino-pretty
```

**Install dependencies:**
```bash
npm install
```

**Build Docker image (auto-tags with timestamp):**
```bash
./build.sh
```

There is no test suite or linter configured.

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Server port |
| `MONGO_CONNECTION_STRING` | `mongodb://localhost:27017?directConnection=true` | MongoDB URI |
| `MONGO_DB_NAME` | `smile_works` | Database name |
| `LOG_LEVEL` | `info` | Pino log level (trace/debug/info/warn/error) |
| `AUTH_JWT_SECRET` | `123` | JWT signing secret |
| `AUTH_JWT_DURATION` | `1h` | JWT expiry |

## Architecture

### Request Lifecycle

1. **CORS** — applied globally
2. **JWT Auth middleware** (`app.js`) — all routes except `POST /api/auth/login` and `POST /api/auth/logout` require a `Bearer <token>` header. Decoded user ID is set on `req.user`. Logged-out tokens are tracked in an in-memory `Set` (`blacklistedTokens`).
3. **Metadata middleware** (`app.js`) — on every POST/PUT, auto-generates `_id` (UUID v4) if absent and sets/updates `_metadata` (createdAt, lastUpdatedAt, updatedBy, version).
4. **Route handlers** — each resource has a dedicated file in `routes/`.

### Key Files

- `app.js` — entry point; wires middleware and mounts routers, then connects to MongoDB and starts listening
- `init.js` — exports shared config: `PORT`, `logger` (Pino), `connectToMongoDB`, `modelNames`, `auth`
- `init-scripts/init.org.js` — seeds a default `sampleOrg` organization on startup (runs after server starts)
- `lib/metadataHandler.js` — `generateId()`, `createMetadata()`, `updateMetadata()`
- `lib/middleware.apiLogger.js` — logs every incoming request at the configured log level

### Route / Schema Pattern

Most resources follow this pattern in their route file:

```js
const crud = new mongooseCrud(collectionName, schema, null);
const Model = mongoose.model(init.modelNames.resource, schema);

router.get("/", crud.find);
router.get("/:id", crud.findById);
router.get("/utils/count", crud.count);
router.post("/", crud.create);
router.put("/:id", crud.update);
router.delete("/:id", crud.deleteById);
router.delete("/utils/deleteMany", crud.deleteMany);
router.post("/utils/aggregate", crud.aggregate);
```

**Important:** `/utils/*` routes must be registered **before** `/:id` routes, otherwise Express treats `"utils"` as an ID parameter.

Custom business logic routes are added alongside the CRUD routes (e.g., appointment availability, schedule grouping by day/week).

### Data Model Conventions

All documents share these conventions:
- `_id` — string (UUID v4), not MongoDB ObjectId
- `_metadata` — embedded object on every document:
  ```js
  {
    createdAt, lastUpdatedAt,  // timestamps
    updatedBy,                 // user ID or "system"
    isDeleted,                 // soft-delete flag
    version                    // incremented on each update
  }
  ```
- Soft deletes use `_metadata.isDeleted: true`; filter with `"_metadata.isDeleted": false` in queries

### Authentication

- `POST /api/auth/login` — looks up user by `_id` (username), verifies SHA-256+salt hash, returns JWT + user name
- `GET /api/auth/verify` — validates token, returns user document (without password/salt)
- `POST /api/auth/logout` — adds token to the in-memory blacklist

Note: JWT blacklist is in-memory only and resets on server restart.

### Model Registration

Models are registered in individual route files via `mongoose.model(name, schema)`. The canonical name strings live in `init.modelNames`. When a route file needs to reference another model (e.g., appointment enriches with User and Patient data), it calls `mongoose.model("ModelName")` without a schema to retrieve an already-registered model — this requires that the other route file has already been loaded.

### Adding a New Resource

1. Create `schemas/schema.<resource>.js` with `_id: String` and `_metadata` fields
2. Add the model name to `init.modelNames` in `init.js`
3. Create `routes/routes.<resource>.js` following the standard CRUD pattern
4. Mount the router in `app.js` after `await init.connectToMongoDB()`
