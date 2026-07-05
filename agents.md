# agents.md — WarEra DMG Command Center

This document contains context and rules for AI agents working on the project. Read it before making any code changes.

---

## 1. Project Overview

**WarEra DMG Command Center** is a tactical, sci-fi/command-center-style dashboard that aggregates data from the WarEra game (via its public tRPC API) and presents it as KPIs, tables, and detailed player cards.

The application displays data for two main entities:
- **The Federation** — alliance (feed), aggregated DMG and a military unit (MU) ranking.
- **Justice** — a specific military unit (justice), player ranking by period.

---

## 2. Technology Stack

- **Framework:** Nuxt 4 (`nuxt` ^4.4.8) with `type: module`.
- **Frontend:** Vue 3 + Composition API (`<script setup>`), Vue Router 5.
- **Language:** TypeScript 6 (`vue-tsc` for type-checking).
- **Styling:** Tailwind CSS 6 via `@nuxtjs/tailwindcss`.
- **Icons:** `lucide-vue-next`.
- **Package Manager:** `pnpm` (required version `10.34.1`).
- **Server:** Nuxt Nitro — endpoints in `server/api/**/*.ts`.
- **HTTP Client:** `ofetch` (provided by Nuxt, used in `server/utils/wareraClient.ts`).
- **Deployment:** Docker + Coolify (optional), configuration in `Dockerfile`.

---

## 3. Directory Structure

```
g:\_programowanie\_projekty\warera
├── app/                       # Nuxt app (frontend + composables)
│   ├── app.vue                # Root template with <NuxtPage>
│   ├── assets/css/main.css    # Tailwind directives + custom classes (.panel, .clip-corner, .skel, etc.)
│   ├── components/            # Vue components
│   │   ├── DamageTable.vue
│   │   ├── FlagBadge.vue
│   │   ├── KpiCard.vue
│   │   ├── PlayerDailyCard.vue
│   │   ├── PlayerTable.vue
│   │   └── TopBar.vue
│   ├── composables/           # useDashboard.ts — main state and data fetching
│   ├── pages/                 # index.vue — main dashboard page
│   └── utils/                 # format.ts — number, date, and flag formatting
├── server/                    # Nitro server
│   ├── api/                   # HTTP endpoints
│   │   ├── federation.get.ts
│   │   ├── federationSupport.get.ts
│   │   ├── health.get.ts
│   │   ├── justice.get.ts
│   │   ├── justicePlayerDaily.get.ts
│   │   └── meta.get.ts
│   └── utils/                 # Server-side logic
│       ├── wareraClient.ts    # tRPC client with rate-limiting and retry
│       └── wareraService.ts   # WarEra API data aggregation
├── shared/                    # Shared TypeScript types (e.g., types/warera)
├── tailwind.config.js         # Full Tailwind palette and custom classes
├── nuxt.config.ts             # Nuxt config + runtimeConfig
├── STYLE.md                   # Full visual style guide: "Tactical Command Center"
└── .env.example               # Required environment variables
```

---

## 4. Code Conventions

### General
- **Vue 3 Composition API** — always use `<script setup lang="ts">`.
- **TypeScript** — all new `.ts`/`.vue` files must be typed.
- **ES6+** — prefer `const`/`let`, arrow functions, destructuring, optional chaining.
- **Reactivity** — use `ref()`, `computed()`, and `useState()` (Nuxt) appropriately.
- **Async/await** — instead of `.then()` chains.

### Frontend
- Fetch data through the `useDashboard()` composable (periods, live refresh, handling `building` for federationSupport).
- Components receive props via `interface` with `defineProps<...>()`.
- Emit events via `defineEmits<...>()`.
- Delegate data formatting (numbers, dates, flags) to `app/utils/format.ts`.

### Server
- Endpoints in `server/api/*.get.ts` return data via `defineEventHandler(() => ...)`.
- Aggregation logic lives in `server/utils/wareraService.ts`.
- External API calls go through `server/utils/wareraClient.ts` (`trpcGet`).
- **Do not log secrets** — `wareraApiKey` is read only via `useRuntimeConfig()`.

### Tailwind / CSS
- Detailed style is described in `STYLE.md`. Key classes:
  - `.panel` — semi-transparent card with backdrop-blur and clipped corners.
  - `.clip-corner` / `.clip-corner-sm` — geometric corner cuts.
  - `.heading-display` — Saira Condensed, uppercase, tracking-wide headings.
  - `.data-mono` — numeric data in JetBrains Mono, tabular-nums.
  - `.chip` — small badge.
  - `.skel` — shimmer skeleton loader.
- Color accents: `fed` (amber) and `just` (cyan) — see `tailwind.config.js`.
- Fonts: Saira Condensed, Inter Tight, JetBrains Mono (loaded from Google Fonts in `nuxt.config.ts`).

---

## 5. Environment & Configuration

Required / recommended `.env` variables:

```env
# Required only in production / Docker (NUXT_ prefix)
NUXT_WARERA_API_KEY=         # Optional API key (increases rate-limit quota)
NUXT_WARERA_BASE_URL=https://api2.warera.io/trpc

# Optional — target entity identifiers (resolved by name by default)
WARERA_ALLIANCE_NAME=The Federation
WARERA_NAME=Justice
```

**Important:** Nuxt runtimeConfig maps `NUXT_WARERA_API_KEY` → `runtimeConfig.wareraApiKey`. Therefore, in production/Docker, variables must use the `NUXT_` prefix. In `nuxt dev`, a plain `.env` file is sufficient.

---

## 6. API Architecture (Nuxt server → WarEra tRPC)

- `server/utils/wareraClient.ts` implements a minimal tRPC client over HTTP GET.
- `trpcGet(procedure, args, retries)` handles:
  - automatic URLs with `input={...}`,
  - `X-API-Key` header,
  - parsing `ratelimit-*` headers,
  - retry with exponential backoff for 429 / 5xx.
- `server/utils/wareraService.ts` contains business logic: entity lookup, DMG aggregation, rankings, pagination handling, and adding MUs outside the alliance.
- Endpoints in `server/api/` are a thin layer: they accept query params (`period`), call the service, and return JSON.
- `federationSupport` may return `{ building: true }` — the frontend then polls every 15s (see `useDashboard.ts`).

---

## 7. Guidelines for AI Agents

Before implementing changes:

1. **Always check `STYLE.md`** for visual changes. Do not create new color palettes or fonts — use existing tokens `fed`/`just`/`base`/`live`/`danger`.
2. **Do not add unnecessary dependencies** — the project is intentionally minimal. If you need a new library, justify it.
3. **Preserve existing architecture:**
   - frontend fetches data via `useDashboard()`,
   - endpoints delegate to `wareraService.ts`,
   - external calls go through `wareraClient.ts`.
4. **Do not duplicate formatting logic** — extend `app/utils/format.ts` instead of writing ad-hoc code in components.
5. **Add types** — place new DTOs/responses in `shared/types/warera.ts` (or an appropriate file in `shared/`).
6. **Production env vars must use the `NUXT_` prefix** — never assume unprefixed variables will work in Docker/Coolify.
7. **Rate-limiting** — the WarEra API has limits. Avoid uncontrolled bursts from the frontend; retry/throttle logic lives on the server.
8. **Test locally** via `pnpm dev` (port 3000) before proposing changes.
9. **Comment code** explaining non-trivial decisions (per project-wide rules). Do not remove existing comments.
10. **Language** — UI text is in English (dashboard). Technical documentation may be kept in Polish only if the user explicitly asks for it.

---

## 8. Useful Commands

```bash
# Install dependencies
pnpm install

# Dev server (http://localhost:3000)
pnpm dev

# Type-check
pnpm vue-tsc --noEmit

# Production build
pnpm build

# Preview build
pnpm preview
```

---

## 9. Key Reference Files

- `STYLE.md` — full visual style guide.
- `nuxt.config.ts` — Nuxt config, runtimeConfig, head/meta, fonts.
- `tailwind.config.js` — color tokens, fonts, animations, box shadows.
- `app/assets/css/main.css` — custom CSS classes (.panel, .clip-corner, .skel, etc.).
- `app/composables/useDashboard.ts` — main dashboard state and refresh logic.
- `server/utils/wareraClient.ts` — tRPC client + rate-limiting.
- `server/utils/wareraService.ts` — WarEra data aggregation.
