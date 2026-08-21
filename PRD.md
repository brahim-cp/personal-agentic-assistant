## Personal Health & Lifestyle Assistant — Product Requirements Document

> **Status: v0.4 DRAFT — build-ready spec.** All top-level decisions (§0) and all seven open decisions are now **RESOLVED** (see the decisions log at the end). Remaining ⟨TBD⟩ markers are limited to values deliberately deferred (the exact Bedrock model ID, hardcoded later) and the per-feature test-bullet list, which we write during TDD.

### 0. Locked decisions

| # | Decision | Choice |
|---|---|---|
| 1 | **Four sub-agents** | ① Nutrition specialist · ② Chef (easy-to-make meals) · ③ Secretary (Google Calendar) · ④ Sport coach |
| 2 | **Tech stack** | TypeScript (Node 22+) · Vercel AI SDK v5 · **Amazon Bedrock** (Claude on Bedrock, model hardcoded later) · Notion hosted MCP · Tavily search · Google Calendar API |
| 3 | **Web search** | Tavily REST, hand-wrapped via `tool()` (no SDK) |
| 4 | **Routing** | Hub-and-spoke — orchestrator (hub) exposes the four sub-agents (spokes) **as tools**; the LLM decides which to call and can chain them |
| 5 | **Interface** | Console — invoked from Claude Code in plain English; only npm script is `test` |
| 6 | **Scope (v1)** | Single user, no auth, no scheduled/background runs, **no wearable / fitness-tracker imports** |

### 1. Overview

A console-based **personal health & lifestyle assistant**. An orchestrator (the Brain) reads the user's natural-language request, applies saved preferences and the user's health profile, then routes the work to one or more of four specialized sub-agents — a **nutrition specialist**, an **easy-meals chef**, a **Google-Calendar secretary**, and a **sport coach** — and synthesizes a single coherent reply. Durable state (health profile, meal plans, recipes, workout plans, logs) lives in **Notion** as the system of record; scheduled events live in **Google Calendar**; fresh external information comes from **Tavily** web search.

The assistant is for **a single user** at the terminal. It runs conversationally: type a request ("plan three easy high-protein dinners this week and block prep time Sunday"), watch the orchestrator delegate to the right sub-agents, and see meals land in Notion and time blocks land on your calendar. Tell it preferences ("no cilantro", "workouts max 30 min", "meals under 5 ingredients") and every future run shapes itself to match.

#### 1.1 Who the assistant works for — and its identity

The assistant serves **one health-conscious user** who wants to eat well, cook simply, stay organized, and train consistently without stitching four apps together. Its job is to reduce effort across four coupled chores — deciding *what to eat*, *how to cook it*, *when to do things*, and *how to train* — and to keep those four in sync (a workout day nudges the day's calories; a busy calendar day nudges the chef toward a 10-minute meal).

**Canonical assistant identity — use verbatim in every system prompt.** *You are a personal health and lifestyle assistant coordinating four specialists: a nutrition specialist, a chef of easy meals, a secretary who manages the user's Google Calendar, and a sport coach. You plan, organize, and draft; you never invent nutritional facts, you always respect the user's dietary restrictions and allergies, and you encourage safe, sustainable habits over extreme measures.* Anchoring every sub-agent on this identity prevents drift between the orchestrator's framing and each specialist's behavior, and — critically — keeps the safety rules of §11 present in every prompt.

#### 1.2 Repo layout

Folders map directly to the components (orchestrator, four sub-agents, shared tools, memory).

```
.
├── PRD.md                              # this document
├── README.md
├── package.json                        # one script: "test"
├── package-lock.json
├── tsconfig.json                       # type-check only (noEmit)
├── vitest.config.ts                    # per-test timeout
├── .env.example
├── .gitignore
├── src/
│   ├── orchestrator/
│   │   ├── orchestrate.ts              # routeRequest — loads prefs + profile, routes to sub-agents, synthesizes
│   │   └── prompts/
│   │       └── orchestrator.md         # system prompt for routing + synthesis
│   ├── agents/                         # the four spokes — one file + one prompt each
│   │   ├── nutrition.ts                # runNutrition + NutritionSchema
│   │   ├── chef.ts                     # runChef      + MealPlanSchema / RecipeSchema
│   │   ├── secretary.ts               # runSecretary  + CalendarOpSchema
│   │   ├── coach.ts                    # runCoach     + WorkoutSchema
│   │   └── prompts/
│   │       ├── nutrition.md
│   │       ├── chef.md
│   │       ├── secretary.md
│   │       └── coach.md
│   ├── tools/
│   │   ├── tavily.ts                   # searchWeb tool() — Tavily wrapper, blocklist inline
│   │   ├── notion.ts                   # getNotionMcp() + local CRUD wrappers over Notion MCP
│   │   └── gcal.ts                     # getCalendarClient() + listEvents/createEvent/updateEvent/deleteEvent
│   └── memory/
│       └── preferences.ts              # listPreferences / addPreference / removePreference (+ preferences.md)
└── tests/                              # mirror of src/, one .test.ts per module, created per-feature in TDD
```

**Conventions (carried from the reference):** one file per sub-agent, named for the verb it exports (`nutrition.ts` → `runNutrition`); schemas colocated with their producer, not a central `types.ts`; no `index.ts` barrels; prompts loaded at runtime via `tsx`; `.ts` import extensions throughout; static single-consumer data (e.g. the Tavily blocklist) inlined as a `const`.

### 2. Goals

- **Orchestrate four specialists.** The Brain classifies each request and routes to the right sub-agent(s), chaining them when a request spans domains.
- **Give sound nutrition guidance.** The Nutrition Agent sets targets from the profile + goal (§5.1 method), respects restrictions/allergies absolutely, and cites sources for factual claims.
- **Suggest easy, cookable meals.** The Chef Agent produces recipes/meal plans honoring the nutrition targets and the "easy" caps (§5.2), plus a consolidated grocery list.
- **Manage the calendar.** The Secretary Agent reads and writes Google Calendar events with no double-booking.
- **Coach training.** The Coach Agent builds workout plans matched to level/goal/time/equipment and adapts to logs.
- **Keep everything in sync via Notion.** Profile, targets, meal plans, recipes, workouts, and logs are real Notion rows — no duplicates, status tracked, cross-linked.
- **Apply preferences + profile every run.** Loaded at the start of each run; saves are explicit — never auto-inferred.
- **Be observable.** Routing, hand-offs, tool calls, and results stream to the terminal in real time.

### 3. Non-goals (v1)

- Web UI / mobile app / chat widget — console only.
- Multi-user or team usage; auth, roles, sharing.
- Scheduled / background / autonomous runs — the assistant acts only when invoked.
- **Medical or clinical advice.** Flags when to consult a professional (§11); never diagnoses or treats.
- Auto-inferred memory — saving preferences the user did not explicitly state.
- **No wearable / fitness-tracker imports** — no Apple Health, Google Fit, Strava, Garmin, Fitbit, etc. Progress is captured only via what the user tells the assistant and the Notion **Logs** DB.
- Integrations beyond Tavily + Notion + Google Calendar — no grocery-delivery or messaging in v1.
- Sending invites/emails to other people — calendar events are for the single user only.
- Production guardrails (rate limiting, cost caps) and output-quality evals.

### 4. Architecture — the components

Hub-and-spoke. One **orchestrator** (hub) exposes four **sub-agents** (spokes) as tools, over three shared resources (Tavily, Notion, Google Calendar) plus a preferences memory and a health profile.

```
                          user (plain English)
                                  │
                                  ▼
             ┌─────────────────────────────────────────┐
             │   Orchestrator (hub / the Brain)         │
             │   · loads preferences.md + health profile│
             │   · classifies intent                    │
             │   · calls sub-agent tools (can chain)    │
             │   · synthesizes one reply                │
             └───┬─────────┬──────────┬─────────┬───────┘
                 │         │          │         │
                 ▼         ▼          ▼         ▼
          ①Nutrition   ②Chef     ③Secretary  ④Coach
             │            │          │           │
        ┌────┴───┐   ┌────┴───┐     │      ┌────┴────┐
        ▼        ▼   ▼        ▼     ▼      ▼         ▼
     Tavily   Notion Tavily Notion  Google  Tavily  Notion
     search    DB    search  DB    Calendar search   DB
```

| Component | What it does | Implementation |
|---|---|---|
| **Orchestrator (Brain)** | Loads prefs + profile, classifies intent, routes, synthesizes. | Claude-on-Bedrock via AI SDK `generateText`. Sub-agents exposed **as tools**; the Brain chains them. Model constant in `orchestrate.ts`, **hardcoded later** (§12). |
| **① Nutrition Agent** | Calorie/macro targets from profile + goal; enforces restrictions; sourced reasoning. | Own mini-loop; `searchWeb`. Emits `NutritionSchema`. **Owns** its writes to Nutrition Targets (§7-ownership). |
| **② Chef Agent** | Recipes + meal plans honoring targets + "easy" caps; grocery list. | Own mini-loop; `searchWeb`. Emits `MealPlanSchema`/`RecipeSchema`. **Owns** its writes to Recipes + Meal Plans. |
| **③ Secretary Agent** | Reads/writes Google Calendar; no double-booking. | Own mini-loop; `gcal.ts` tools. Emits `CalendarOpSchema`. **Owns** its calendar writes. |
| **④ Coach Agent** | Workout plans by level/goal/time/equipment; adapts to logs. | Own mini-loop; `searchWeb`. Emits `WorkoutSchema`. **Owns** its writes to Workouts. |
| **Web Search (shared)** | Fresh nutrition/recipe/exercise info. | Tavily REST, hand-wrapped via `tool()`. Used by Nutrition, Chef, Coach. |
| **Notion (shared DB)** | System of record. | Notion **hosted MCP**; CRUD wrappers in `tools/notion.ts` called from each sub-agent's code, not exposed raw to any Brain. |
| **Google Calendar (shared)** | The user's schedule. | `googleapis` + OAuth in `tools/gcal.ts`; typed wrappers. |
| **Memory (`preferences.md`)** | Behavioral preferences — **complements** the profile. | Local Markdown + three `tool()`-wrapped helpers exposed to the orchestrator. See §8. |
| **Health profile** | Body facts, goals, restrictions, equipment, limitations. | Single Notion **Profile** row — **system of record** for health data. Loaded every run. §8. |

#### 4.1 Routing model — sub-agents-as-tools

The orchestrator's `generateText` loop is given four tools — one per sub-agent — each wrapped with `tool()`. Each tool's `execute` runs that sub-agent end-to-end (its own mini-loop + structured output **+ its own persistence**, per §7-ownership) and returns typed data plus a short persistence receipt (e.g. the created Notion page ID). The Brain reads the request + preferences + profile, calls one or more sub-agents **in sequence, feeding outputs forward**, then writes the final synthesized reply. The three preference tools also sit in the orchestrator's tool map.

#### 4.2 Inside vs outside the loop

- **Inside the orchestrator loop (exploratory):** the four sub-agent tools + `listPreferences` / `addPreference` / `removePreference`.
- **Inside each sub-agent's own loop (exploratory):** `searchWeb` (Nutrition, Chef, Coach) and the calendar read tools (Secretary).
- **Outside each sub-agent's loop (deterministic, code-side):** schema-validation (`generateObject` + Zod), Notion writes via CRUD wrappers (keyed on stable IDs, `isError`-checked), and Google Calendar writes. Profile + preferences are loaded in code before the orchestrator loop starts.

### 5. The four sub-agents in detail

#### 5.1 ① Nutrition specialist — RESOLVED method (#3)
- **Input:** the request + health profile (age, sex, weight, height, activity level, goal, restrictions/allergies).
- **Method (pinned):**
  1. **BMR — Mifflin-St Jeor.** Male: `10·kg + 6.25·cm − 5·age + 5`. Female: `10·kg + 6.25·cm − 5·age − 161`. For `sex: 'other'`, average the two.
  2. **TDEE — activity factor:** sedentary 1.2 · light 1.375 · moderate 1.55 · active 1.725 · very_active 1.9.
  3. **Goal adjustment:** lose **−15%** · maintain **0%** · gain **+10%**.
  4. **Macros:** protein **1.6–2.2 g/kg** bodyweight · fat **≥ 0.6 g/kg** · carbs fill the remaining calories.
  5. **Hard floor (safety, §11):** the daily target is **never set below BMR**. If the −15% cut would breach BMR, clamp to BMR and note it in `reasoning`.
- **Does:** computes targets, explains the reasoning, uses `searchWeb` only for factual lookups (e.g. protein content of a food) — never to guess the arithmetic above.
- **Output:** `NutritionSchema` (targets + rationale + restrictions echoed back verbatim). Persists a Nutrition Targets row.
- **Hard rule:** restrictions/allergies are absolute and passed downstream verbatim.

#### 5.2 ② Chef (easy meals) — RESOLVED caps (#2)
- **Input:** nutrition targets + constraints (restrictions, likes/dislikes, equipment) + the "easy" caps.
- **"Easy" caps (pinned project constants, in `chef.ts`):** **≤ 30 min** total time · **≤ 8 ingredients** · **common equipment only** (stovetop, oven, microwave, one pot / one pan). These are defaults, overridable per request ("give me something in 10 minutes", "I only have a microwave").
- **Does:** proposes recipes / a multi-day meal plan hitting the targets within the caps; produces a consolidated, de-duplicated grocery list.
- **Output:** `MealPlanSchema` / `RecipeSchema`; persists to the Recipes + Meal Plans DBs.
- **Hard rule:** a restricted ingredient never appears — a violation is a hard failure that triggers regeneration (§14).

#### 5.3 ③ Secretary (Google Calendar) — RESOLVED auth + policy (#4)
- **Input:** things to schedule (prep blocks, workout slots, reminders) + the user's existing calendar.
- **Auth (pinned):** OAuth 2.0 **desktop flow** with a stored **refresh token** in env (`GOOGLE_REFRESH_TOKEN`). No service account.
- **Calendar (pinned):** a **dedicated "Assistant" calendar** (its own `GOOGLE_CALENDAR_ID`), never the user's primary — so the agent (and tests) can only ever touch its own events.
- **Write policy (pinned):** **create-on-request** — no confirmation gate. Safe because (a) every op is streamed to the terminal as it happens, (b) writes go only to the dedicated calendar, and (c) `deleteEvent` is always available to undo. Conflict handling: read first, and if a slot collides, propose an alternative rather than double-book.
- **Does:** reads for conflicts, creates/updates/deletes events. **Never invites other people.**
- **Output:** `CalendarOpSchema`; writes to Google Calendar.

#### 5.4 ④ Sport coach
- **Input:** fitness level, goal, available time/days, equipment, injuries/limitations (from profile), recent logs.
- **Does:** builds a workout or weekly plan matched to those; adapts to logged progress; uses `searchWeb` for exercise form/alternatives. Flags pain/injury as a stop-and-see-a-professional signal (§11).
- **Output:** `WorkoutSchema`; persists to the Workouts DB and can hand time blocks to the Secretary.

#### 5.5 Flagship chained flow
> "Plan my week: easy high-protein dinners, three 30-minute workouts, and put it all on my calendar."

`orchestrator` → `runNutrition` (targets) → `runChef` (5 dinners + grocery list, hitting targets) → `runCoach` (3× 30-min sessions) → `runSecretary` (blocks prep + workouts around existing events) → synthesized summary. Each sub-agent persists its own rows; the Secretary writes the blocks; the orchestrator only synthesizes.

### 6. Interaction — Claude Code, plain English

Console-initiated; no CLI entry point. Requests are typed into Claude Code and call the exports directly.

| Action | What you type |
|---|---|
| Nutrition targets | "What should my daily protein target be for fat loss?" |
| Meal plan | "Give me 3 easy dinners under 30 minutes this week" |
| Schedule | "Block 45 min for meal prep Sunday afternoon" |
| Workout | "Build me a 30-minute full-body dumbbell workout" |
| Chained | "Plan my week's dinners and workouts and put them on my calendar" |
| Run tests | `/tdd` or `npm test` |

#### 6.1 Streaming output (illustrative)

```
$ Plan my week's dinners and workouts and put them on my calendar
[orch]     listPreferences() → 4 prefs · profile loaded (goal: fat loss, no shellfish)
[orch]     routing → nutrition → chef → coach → secretary
[nutrition] BMR 1,540 · TDEE 2,240 · target 1,900 kcal (−15%) · 160 P / 60 F / 170 C
[chef]      searchWeb("high protein 20 minute dinners") → 5 results
[chef]      5 dinners drafted · grocery list (23 items) → Notion
[coach]     3× 30-min full-body sessions → Notion
[secretary] gcal.listEvents → 2 conflicts avoided · 8 events created (Assistant cal)
[orch]      synthesis ready
✓ Week planned — meals + workouts in Notion, 8 blocks on your calendar.
```

### 7. Data models & write ownership

All sub-agent outputs are **structured JSON validated by Zod** so chaining and persistence never re-parse free text.

**Write ownership (RESOLVED, #7): each sub-agent owns writes to its own resource.** The orchestrator is a pure router — it never writes to Notion or the calendar. Each sub-agent, after its own loop returns, validates its output and calls the relevant `notion.ts` / `gcal.ts` wrapper itself (mirrors the reference PRD where `researchCompany` owns its own upsert). This keeps persistence wrappers colocated with the agent that produces the data and keeps the orchestrator's tool surface small. The Profile row is written only by an explicit "update my profile" path on the orchestrator side (it is shared context, not owned by any one specialist).

```ts
// Shared — loaded every run, read-only to sub-agents unless the user updates it
const ProfileSchema = z.object({
  ageYears: z.number().int().positive(),
  sex: z.enum(['female', 'male', 'other']),
  weightKg: z.number().positive(),
  heightCm: z.number().positive(),
  activityLevel: z.enum(['sedentary', 'light', 'moderate', 'active', 'very_active']),
  goal: z.enum(['lose', 'maintain', 'gain']),
  restrictions: z.array(z.string()),        // e.g. ['no shellfish', 'lactose intolerant'] — SAFETY-CRITICAL
  equipment: z.array(z.string()),           // e.g. ['dumbbells', 'oven']
  limitations: z.array(z.string()),         // e.g. ['left knee — avoid deep squats']
});

// ① Nutrition
const NutritionSchema = z.object({
  bmr: z.number().int().positive(),
  tdee: z.number().int().positive(),
  dailyCalories: z.number().int().positive(),
  macros: z.object({ proteinG: z.number(), fatG: z.number(), carbG: z.number() }),
  reasoning: z.string(),                     // method + goal adjustment + any BMR-floor clamp; cite sources
  restrictionsEcho: z.array(z.string()),     // passed downstream verbatim
  seeAProfessional: z.boolean(),             // true if request touches medical territory (§11)
});

// ② Chef
const RecipeSchema = z.object({
  name: z.string(),
  prepMinutes: z.number().int().positive(),
  ingredients: z.array(z.object({ item: z.string(), qty: z.string() })),
  steps: z.array(z.string()),
  approxCalories: z.number().int().positive(),
  macros: z.object({ proteinG: z.number(), fatG: z.number(), carbG: z.number() }),
});
const MealPlanSchema = z.object({
  days: z.array(z.object({ day: z.string(), meals: z.array(RecipeSchema) })).min(1),
  groceryList: z.array(z.object({ item: z.string(), qty: z.string() })),
});

// ③ Secretary
const CalendarOpSchema = z.object({
  operations: z.array(z.object({
    action: z.enum(['create', 'update', 'delete']),
    title: z.string(),
    start: z.string().datetime(),
    end: z.string().datetime(),
    eventId: z.string().optional(),          // set on update/delete
  })).min(1),
  conflictsAvoided: z.array(z.string()),
});

// ④ Coach
const WorkoutSchema = z.object({
  name: z.string(),
  durationMinutes: z.number().int().positive(),
  exercises: z.array(z.object({
    name: z.string(),
    sets: z.number().int().positive(),
    reps: z.string(),                        // "8–12" or "30s"
    notes: z.string().optional(),
  })).min(1),
  intensity: z.enum(['easy', 'moderate', 'hard']),
});
```

**Honesty rule (all agents):** no invented nutrition numbers, sources, or exercise claims. Factual figures come from `searchWeb` or the profile — if evidence is thin, say so. A short honest answer beats a padded one.

### 8. Memory model — Notion profile + `preferences.md` complement

The two stores play distinct, complementary roles and are both loaded every run:

- **Notion Profile row — system of record for *health data*.** Structured, safety-critical facts (age, weight, height, activity level, goal, **restrictions/allergies**, equipment, limitations). Read on every run; restrictions flow downstream verbatim (§5.1, §11). Written only via an explicit "update my profile" path (§7).
- **`src/memory/preferences.md` — complement for *behavioral preferences*.** Free-form, user-stated style rules ("no cilantro", "meals under 5 ingredients", "no burpees", "no workouts before 8am"). Managed by `listPreferences` / `addPreference` / `removePreference`, exposed to the orchestrator.

The orchestrator reads **both** at the start of each run, applies matching preferences, and saves new ones **only on explicit instruction** — never auto-inferred. Rule of thumb: **fact about the body or a hard constraint → Profile; a taste or style choice → `preferences.md`.** On conflict, the Profile's safety-critical restrictions always win over a stylistic preference.

### 9. Storage — Notion (RESOLVED shapes, #6)

One Notion workspace; each DB owned by the agent that writes it (§7). **Primary field** is the dedup / upsert key for that table.

**Profile** (single row; `userKey = "me"` as primary so upsert always targets the one row)

| Property | Type | Notes |
|---|---|---|
| userKey | Title (primary) | Constant `"me"` — single-user, single row |
| ageYears | Number | |
| sex | Select | female / male / other |
| weightKg | Number | |
| heightCm | Number | |
| activityLevel | Select | sedentary / light / moderate / active / very_active |
| goal | Select | lose / maintain / gain |
| restrictions | Multi-select | SAFETY-CRITICAL |
| equipment | Multi-select | |
| limitations | Multi-select | |

**Nutrition Targets** (owner: Nutrition)

| Property | Type | Notes |
|---|---|---|
| date | Title (primary) | ISO date — one target set per day; upsert key |
| dailyCalories | Number | |
| proteinG / fatG / carbG | Number | |
| bmr / tdee | Number | |
| reasoning | Rich text | |

**Recipes** (owner: Chef)

| Property | Type | Notes |
|---|---|---|
| name | Title (primary) | Recipe name — upsert key |
| prepMinutes | Number | |
| ingredients | Rich text | Markdown bullet list |
| steps | Rich text | Numbered list |
| approxCalories | Number | |
| proteinG / fatG / carbG | Number | |

**Meal Plans** (owner: Chef)

| Property | Type | Notes |
|---|---|---|
| week | Title (primary) | e.g. `2026-W34` — upsert key |
| recipes | Relation → Recipes | The meals in the plan |
| groceryList | Rich text | Consolidated, de-duplicated |

**Workouts** (owner: Coach)

| Property | Type | Notes |
|---|---|---|
| name | Title (primary) | e.g. `2026-08-19 Full-body` — upsert key |
| date | Date | |
| durationMinutes | Number | |
| exercises | Rich text | Markdown list (name · sets · reps · notes) |
| intensity | Select | easy / moderate / hard |

**Logs** (owner: Coach + Nutrition)

| Property | Type | Notes |
|---|---|---|
| entry | Title (primary) | e.g. `2026-08-19 meal` — upsert key |
| date | Date | |
| type | Select | meal / workout |
| payload | Rich text | |
| notes | Rich text | |

**Integration & wrapper contract.** Notion **hosted MCP** via the AI SDK MCP client over Streamable HTTP. Local wrappers in `tools/notion.ts` compose the MCP CRUD primitives — discovered by **exact name** via `client.tools()` (no fuzzy matching), envelope-`isError`-checked on every call — into typed helpers keyed on each table's primary field:

- `upsert<Table>(client, row)` — query by primary field; update if found, else create. One per writable table.
- `get<Table>By<Key>(client, key)` — read primitive returning the row or `null`.
- `delete<Table>By<Key>(client, key)` — **test-cleanup** helper; returns count deleted.

Exact per-table helper names and the "common setup mistakes that break the build" table are written during the TDD build, mirroring the reference PRD's §12.3/§13.4 discipline (property-ID resolution via a one-time schema fetch, structured filters not `filterByFormula`-style guesses, plural `records` payload shapes, etc.).

### 10. Google Calendar integration (RESOLVED, #4)

`tools/gcal.ts` wraps the `googleapis` Calendar client behind typed helpers — `listEvents(timeMin, timeMax)`, `createEvent(evt)`, `updateEvent(id, patch)`, `deleteEvent(id)` — all scoped to the **dedicated Assistant calendar** (`GOOGLE_CALENDAR_ID`). Only the Secretary uses them; the raw client is never exposed to a Brain. Auth: OAuth 2.0 desktop flow, refresh token in env. Policy: create-on-request, read-before-write to avoid double-booking, delete always available. Tests run against this same dedicated calendar and clean up their own events in `afterAll`, so real calendars are never touched.

### 11. Safety & wellbeing rules (load-bearing)

These live in **every** sub-agent prompt and are non-negotiable:
- **Restrictions/allergies are absolute.** The chef never proposes a restricted ingredient; nutrition echoes restrictions downstream verbatim; a violation is a hard failure, not a soft preference.
- **No extreme measures.** No crash diets, **sub-BMR calorie targets** (enforced by the §5.1 floor), purging, over-training, or "lose X kg in Y days" plans. Sustainable, gradual habits only.
- **Not medical advice.** For pregnancy, eating disorders, diabetes, injuries, or any medical condition, the assistant states its limits and recommends a professional (`seeAProfessional: true`). It does not diagnose or treat.
- **No body-shaming or negative self-talk reinforcement.** Framing stays supportive and non-judgmental.
- **Honesty over completeness.** Better to admit "I can't safely advise on that" than to fabricate.

### 12. Tech stack & dependencies

**Runtime:** `ai@^5` (core: `generateText`, `generateObject`, `tool()`, `stepCountIs`) · `@ai-sdk/mcp@~0.0.18` (v5-paired MCP client, `experimental_createMCPClient`) · **`@ai-sdk/amazon-bedrock`** (Bedrock provider — pin to the ai@5-paired major; verify before install) · `googleapis` (Calendar) · `zod`.
**Dev:** `typescript@^5` · `tsx@^4` · `vitest@^3` · `@types/node@^22`.
**Do NOT install:** `ai@6` (deprecates `generateObject`) · `@ai-sdk/mcp@^1` (pairs with ai@6) · `@tavily/core` (call REST with `fetch`) · any local MCP server package (Notion MCP is hosted) · `dotenv` (use Node `--env-file`) · any CLI framework. Loop bound is `stopWhen: stepCountIs(N)`, tool schema field is `inputSchema` (not `parameters`) — same v5 gotchas as the reference.
**Bedrock:** the model ID is a project constant in `orchestrate.ts`, **hardcoded later** — leave a clearly-marked placeholder until then. Note: Bedrock model IDs are **inference-profile IDs** (region-prefixed — EU profile applies for a France-based user). ⟨TBD — exact model + region, deferred.⟩

### 13. Configuration & secrets

Secrets (never committed): AWS creds for Bedrock (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, optional `AWS_SESSION_TOKEN`) · `TAVILY_API_KEY` · `NOTION_API_KEY` (or MCP OAuth token) + per-DB Notion database IDs · Google OAuth (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`) + `GOOGLE_CALENDAR_ID` (the dedicated Assistant calendar). Project constants in code: model ID (hardcoded later), `MAX_SEARCH_RESULTS`, the "easy meal" caps (§5.2), the activity/goal factors (§5.1). Env loaded via Node's native `--env-file`; no `dotenv`. Missing key → clear, actionable error at first use.

### 14. Error handling

- **Search empty** → retry alternate queries (up to 3×), then report the gap and lower confidence in `reasoning`.
- **Notion write fails** (thrown, incl. unwrapped `isError: true`) → surface the error and print the staged output to the terminal as a fallback so work isn't lost.
- **Calendar conflict** → Secretary proposes an alternative slot rather than double-booking.
- **Schema validation fails** → retry up to 2×, then error with diagnostics.
- **Restriction violated by chef output** → hard reject + regenerate; never persist a violating recipe.
- **Sub-BMR target attempted** → clamp to BMR (§5.1) and note it; never emit below-BMR.
- **Missing env var** → clear message naming the var; tests `console.warn` + skip (never silently).

### 15. Testing strategy



<!-- How we test: TDD with real services, no mocks. What "green" really means, the runner contract, and — because this is a health assistant — how the safety rules of §11 get their own non-negotiable, always-runs test tier. This section supersedes the one-paragraph placeholder; §15.1 is the canonical spec, §15.2 is the execution contract, §15.3 says which test is the spec for any given change. -->

- **TDD throughout.** Tests are written before the implementation; every suite starts red and ends green. No sub-agent, tool wrapper, or orchestrator edit lands without a §15.1 bullet that failed before it and passes after.
- **Real services, not mocks.** Tavily tests hit the real Tavily API. Notion tests hit the real Notion workspace via the hosted MCP. Calendar tests hit the **dedicated Assistant calendar** (`GOOGLE_CALENDAR_ID`, never the primary — §10). Bedrock tests make real Claude-on-Bedrock calls. Preferences tests hit the real `src/memory/preferences.md`. Mocks pass when the real thing fails — and integration drift between our code and a service (an MCP tool rename, a Tavily topic default, a Notion property-ID shift) is the exact bug class this project cares most about.
- **Skip cleanly when keys missing — but loudly.** No hard-fails on runs without env vars, but skips must be observable: a `console.warn` at suite start naming the missing var. A green run with every integration suite silently skipped is not a signal — it's a lie. The runner contract that enforces this lives in §15.2.
- **Safety tests are a separate, always-runs tier.** The §11 rules — restrictions/allergies absolute, never sub-BMR, not medical advice, no extreme measures — are not "a feature." They are asserted in their own top-level describe blocks tagged **(safety)**, and the ones that don't need a live LLM run **unconditionally** (never inside `skipIf`). A safety assertion that passes by being skipped is the worst failure mode this suite can have. See §15.1 "Safety rules" and §15.2 "Missing-env / always-runs."
- **Tests clean up after themselves.** Tests that write to Notion delete their rows via the `delete<Table>By<Key>` helpers from `src/tools/notion.ts` (per §9) — not by re-discovering MCP tool names inline. Tests that write to the calendar delete their events via `deleteEvent` from `src/tools/gcal.ts` in `afterAll`. Tests that write to memory restore (or delete) `preferences.md`. **Order matters for linked rows:** `Meal Plans` holds a `Relation → Recipes` (§9), so delete the **Meal Plan row before the Recipe rows** — deleting the recipes first leaves a dangling relation the plan lookup can no longer resolve.
- **Cleanups are wrapped independently.** Each teardown op (delete a Notion row, delete a calendar event, restore a file) runs in its own `try/catch` with `console.warn` on failure. A failing cleanup must not short-circuit the others and must not throw to mask the real test result. Cleanups log; assertions decide pass/fail.
- **Cost & rate-limit control.** Tavily, Bedrock, and Google API calls are metered and real. The project constants `MAX_SEARCH_RESULTS` (in `src/tools/tavily.ts`) and the Bedrock model ID (in `src/orchestrator/orchestrate.ts`) keep iteration cheap; share one real `runNutrition`/`routeRequest` result across a suite via `beforeAll` rather than re-running it per test.
- **§15.1 is the canonical test spec.** Every test asserts a bullet from §15.1; behaviors are not restated elsewhere. If the implementation needs a test that isn't in §15.1, update §15.1 first — that keeps the PRD authoritative and prevents the spec and the suite from drifting.

#### 15.1 Required test coverage by feature

This section is the test specification. Each feature heading lists the behaviors its suite must assert; anything not on this list is out of scope for v1. Bullets are tagged by the **build stage** that introduces them. A bullet is only spec-bearing for the stage it tags; earlier stages assert the subset above the line. Prompts that drive an implementation should cite the §15.1 bullet **for the stage being built** — not "all §15.1 bullets" — so a single prompt never pulls later-stage behavior forward.

---

##### Tavily web search — `searchWeb` (`src/tools/tavily.ts`)

**Description**

- Not unit-tested. Description quality is judgment-based and verified at the agent layer — the real check is whether Nutrition/Chef/Coach pick `searchWeb` for factual-lookup queries once their loops come online.

**Parameters**

- `query` accepts a string (implicit in the non-empty-result test below). **(searchWeb build)**
- `recencyDays` defaults to a project constant when the caller doesn't specify. Tests must assert this default. **(searchWeb build)**

**Function (`execute`)**

- Calling `searchWeb` against the real Tavily API returns a non-empty result list for a normal query (e.g. `"protein content chicken breast"`). **(searchWeb build)**
- Each result has exactly the fields `{ title, url, snippet, publishedDate }` — no extra fields leaking from Tavily's raw response. **(searchWeb build)**
- Every returned result has a parseable `publishedDate` within the requested `recencyDays` window; results without a parseable date are excluded. **(searchWeb build)**
- Results are capped at `MAX_SEARCH_RESULTS` (§13). The suite asserts `results.length <= MAX_SEARCH_RESULTS`. **(searchWeb build)**
- Results from domains in the blocklist are excluded. The blocklist is a `const` array at the top of `src/tools/tavily.ts` and **must ship with 5+ starter entries** — SEO-spam and content-farm domains that surface for generic food/fitness queries and contribute zero factual signal (e.g. low-quality recipe-aggregator and supplement-affiliate sites). The list is **not** extracted into its own module — it's small, single-consumer, and inlining keeps the search tool self-contained (§1.2 convention). **(searchWeb build)**
- **Required Tavily request body: pass `topic: 'news'` in the REST request.** Tavily only reliably populates `published_date` on news-topic searches; the default `topic: 'general'` returns `published_date` null/missing, every result is dropped by the parseable-date filter above, and `searchWeb` returns an empty array. The symptom is the "non-empty result list" test failing despite a working fetch, status 200, and a populated `results` array. **(searchWeb build)**

**Boundary handling (env)**

- When `TAVILY_API_KEY` is missing, the tool throws a clear, actionable error naming `TAVILY_API_KEY` — not a network/parse error or silent failure. Runs **unconditionally** per §15.2 (own top-level describe, never inside `skipIf`). **(searchWeb build)**
- The real-API suite skips cleanly (warns-and-skips) when `TAVILY_API_KEY` is unset. The missing-env test above always runs. **(searchWeb build)**

---

##### Notion MCP integration (`src/tools/notion.ts`)

- `getNotionMcp()` connects to the Notion **hosted MCP** over Streamable HTTP using `NOTION_API_KEY` (or the MCP OAuth token). **(notion connector)**
- The discovered tool list contains the **exact** CRUD primitive names the wrappers depend on, resolved via `client.tools()` — **no fuzzy matching** (§9). Asserting exact names is the canary that catches an MCP-side rename before it corrupts data: without it, fuzzy lookup can route a write to the wrong primitive (e.g. a comment/append tool matched ahead of the page-create tool) and writes land in the wrong place. When this test goes red, update the §9 wrapper contract rather than loosening the assertion. **(notion connector)**
- **Property-ID resolution, not property-name.** Each `upsert<Table>` resolves its target properties via a one-time schema fetch and reads back per-row values by **property ID**, not by display name. The test asserts a written row is read back by ID; reading by name returns `undefined` after any Notion-side property rename and would let the assertion silently pass on every field. **(notion connector)**
- **Structured filters, not `filterByFormula`-style guesses.** Reads query the primary field via the MCP's structured filter param (§9). A test writes a row and retrieves it by primary-field value through the structured filter. **(notion connector)**
- Every wrapper is **envelope-`isError`-checked**: a call that returns `isError: true` throws, it does not return a hollow "success." Asserted by a negative path (e.g. write with a deliberately bad payload → wrapper throws, not returns). **(notion connector)**
- The connection closes cleanly via `close()`. **(notion connector)**
- When `NOTION_API_KEY` or any required per-DB database ID (`NOTION_PROFILE_DB_ID`, `NOTION_NUTRITION_DB_ID`, `NOTION_RECIPES_DB_ID`, `NOTION_MEALPLANS_DB_ID`, `NOTION_WORKOUTS_DB_ID`, `NOTION_LOGS_DB_ID`) is missing, setup throws a clear, actionable error **naming the missing var** — not an opaque MCP/transport failure. Runs **unconditionally** per §15.2. **(notion connector)**
- The real-API suite skips cleanly when `NOTION_API_KEY` or the DB IDs are unset. The missing-env test above always runs. **(notion connector)**

(No business logic of our own here — this is runtime-path verification of the MCP client + wrapper discipline.)

---

##### Nutrition specialist — `runNutrition` + `computeTargets` (`src/agents/nutrition.ts`)

The Nutrition agent has a **deterministic core** (the Mifflin-St Jeor arithmetic of §5.1) wrapped by an LLM loop (reasoning + sourced lookups). The arithmetic is tested against exact numbers; the LLM is tested for shape and honesty. These are different tiers.

**Deterministic arithmetic — `computeTargets(profile)` (pure, no LLM, no env)**

- `computeTargets` is exported and importable directly; it runs with **no network and no API key**. These tests are in an always-runs describe — the pinned method (§5.1) must never depend on a live model. **(nutrition method)**
- **BMR — Mifflin-St Jeor, exact.** Male `{80kg, 180cm, 30y}` → `bmr === 1780`. Female `{50kg, 160cm, 25y}` → `bmr === 1214`. For `sex: 'other'`, the result is the average of the male and female formulas. **(nutrition method)**
- **TDEE — activity factor, exact.** Male case above at `moderate` (×1.55) → `tdee === 2759`. Factors pinned: sedentary 1.2 · light 1.375 · moderate 1.55 · active 1.725 · very_active 1.9. **(nutrition method)**
- **Goal adjustment, exact.** `lose` −15% on the male case → `dailyCalories === 2345`. `maintain` 0% · `gain` +10% asserted on the same profile. **(nutrition method)**
- **Macros within pinned bands.** `proteinG` ∈ [1.6·kg, 2.2·kg], `fatG` ≥ 0.6·kg, `carbG` fills the remaining calories (asserted: `4·protein + 4·carb + 9·fat ≈ dailyCalories`, within rounding). **(nutrition method)**
- **BMR hard floor — the safety invariant.** For **every** profile in a small table (each activity level × each goal), `dailyCalories >= bmr`. **(nutrition method / safety)**
  - *Note on the clamp branch:* with the pinned factors, the lowest case is `lose` at `sedentary` = `1.2 × 0.85 = 1.02 × BMR`, so the −15% cut never breaches BMR under normal inputs — the clamp is a **defensive guard**, not a routine path. To exercise the clamp branch directly, unit-test `computeTargets` with an injected sub-BMR adjusted value (or test the clamp helper in isolation) and assert it returns `bmr` **and** sets the "clamped to BMR" note in `reasoning`. Do not delete the guard just because the arithmetic makes it rare — §11 pins it. **(nutrition method / safety)**

**LLM loop — `runNutrition(request, profile)` (real Bedrock)**

- `runNutrition` is callable and returns an object matching `NutritionSchema` (§7). **(nutrition seed)**
- `bmr`, `tdee`, `dailyCalories`, `macros.*` in the returned object **equal** `computeTargets(profile)` — the LLM reports the arithmetic, it does not re-derive it. This pins §5.1's "searchWeb never to guess the arithmetic." **(nutrition method)**
- `restrictionsEcho` equals `profile.restrictions` **verbatim** (same strings, same order) — the downstream contract of §5.1/§11. **(nutrition seed / safety)**
- `reasoning` is non-empty and, when the LLM makes a factual claim beyond the pinned method (e.g. a food's protein content), the run invokes `searchWeb` at least once (verified via `steps` inspection). **(search wiring)**
- After `runNutrition` returns, the `Nutrition Targets` table contains **exactly one** row keyed on `date` (§9 primary field) whose `dailyCalories`, `bmr`, `tdee` match the returned object. Verified by reading back via the structured-filter primitive and comparing **by property ID** (per the notion-connector rules). **(nutrition persistence)**
- `seeAProfessional` is `true` when the request touches medical territory (see Safety rules). **(safety)**
- Suite skips cleanly when the Bedrock creds (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION`) are unset; the persistence bullets additionally skip when Notion env is unset. `computeTargets` tests never skip. **(nutrition seed / persistence)**

---

##### Chef — `runChef` (`src/agents/chef.ts`)

- `runChef(targets, constraints)` returns an object matching `MealPlanSchema` (with nested `RecipeSchema`), §7. **(chef seed)**
- **"Easy" caps honored (pinned constants in `chef.ts`, §5.2).** Every recipe: `prepMinutes <= 30`, `ingredients.length <= 8`, and equipment referenced stays within the common set (stovetop/oven/microwave/one pot/one pan). Overridable per request — a `"10 minutes"` request asserts `prepMinutes <= 10`. **(chef seed)**
- `groceryList` is **consolidated and de-duplicated** — no item appears twice (case-insensitive). **(chef seed)**
- **Restriction never appears — the load-bearing safety test.** Seed `constraints.restrictions` with a restriction whose banned foods have **paraphrase-resistant tokens** (proper nouns / specific ingredients — e.g. restriction `"no shellfish"` → assert none of `shrimp`, `prawn`, `crab`, `lobster`, `oyster`, `mussel` appears in any `ingredients[].item`; restriction `"peanut allergy"` → assert `peanut` / `groundnut` absent). A hit is a **hard failure**, not a soft miss (§11, §14). **Do not** match on generic tokens like `"seafood"` — assert on the specific banned ingredients so the test proves the restriction propagated, not that the model happened to phrase things safely. **(chef seed / safety)**
- Meals hit the nutrition targets within tolerance: summed `approxCalories` across a day is within ±15% of `targets.dailyCalories`. **(chef seed)**
- After `runChef` returns, the `Recipes` rows (keyed on `name`) and the `Meal Plans` row (keyed on `week`) exist, and the plan's `Relation → Recipes` links resolve to the created recipe record IDs — **id match across both tables**, not a name-substring check. **(chef persistence)**
- Cleanup deletes the **Meal Plan row before the Recipe rows** (relation-holder first, per §15 ordering rule). **(chef persistence)**
- Suite skips cleanly when Bedrock creds are unset; persistence bullets additionally skip when Notion env is unset. **(chef seed / persistence)**

---

##### Secretary — `runSecretary` + `gcal.ts` (`src/agents/secretary.ts`, `src/tools/gcal.ts`)

**Calendar client (`src/tools/gcal.ts`)**

- `getCalendarClient()` authenticates via the OAuth desktop flow using `GOOGLE_REFRESH_TOKEN` and is scoped to `GOOGLE_CALENDAR_ID` (the dedicated Assistant calendar). **(gcal connector)**
- `createEvent` → `listEvents(timeMin, timeMax)` round-trips: an event created in a window is returned by a list over that window, with matching `start`/`end` in RFC 3339. **(gcal connector)**
- `updateEvent(id, patch)` and `deleteEvent(id)` mutate/remove the correct event by ID; a deleted event no longer appears in `listEvents`. **(gcal connector)**
- **Every calendar test targets only `GOOGLE_CALENDAR_ID`** and cleans its events in `afterAll` — the dedicated-calendar guarantee (§10) means cleanup can never touch a real personal calendar. A test asserting the client refuses (or is never pointed at) the primary calendar is the guard here. **(gcal connector)**
- When `GOOGLE_REFRESH_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, or `GOOGLE_CALENDAR_ID` is missing, setup throws a clear error **naming the missing var**. Runs **unconditionally** per §15.2. **(gcal connector)**
- The real-API suite skips cleanly when Google env is unset. The missing-env test always runs. **(gcal connector)**

**Agent (`runSecretary`)**

- `runSecretary(items)` returns an object matching `CalendarOpSchema` (§7); `operations` is non-empty and each `start`/`end` is a valid RFC 3339 datetime. **(secretary seed)**
- **No double-booking (read-before-write, §5.3).** Seed an existing event on the Assistant calendar; ask to schedule an overlapping slot. Assert `conflictsAvoided` is non-empty **and** no created event overlaps the seeded one (id-verified via `listEvents`). **(secretary seed)**
- **Never invites other people (§3, §5.3).** No created event carries an `attendees`/guest list. **(secretary seed / safety)**
- After `runSecretary`, the created events are present on the Assistant calendar (id match via `listEvents`), and cleanup deletes them by ID. **(secretary persistence)**
- Suite skips cleanly when Bedrock or Google env is unset. **(secretary seed / persistence)**

---

##### Coach — `runCoach` (`src/agents/coach.ts`)

- `runCoach(profile, request)` returns an object matching `WorkoutSchema` (§7); `exercises` is non-empty. **(coach seed)**
- **Time cap honored.** A `"30-minute"` request → `durationMinutes <= 30`. **(coach seed)**
- **Limitations respected — safety.** Seed `profile.limitations` with a paraphrase-resistant constraint (e.g. `"left knee — avoid deep squats"`) and assert no exercise name/notes prescribes the banned movement (`deep squat`, `pistol squat`, `jump squat`). Pain/injury in the request sets `seeAProfessional`-equivalent flagging per §11. **(coach seed / safety)**
- Equipment matches the profile: exercises only reference gear in `profile.equipment`. **(coach seed)**
- Uses `searchWeb` for form/alternatives when the request needs a factual lookup (verified via `steps`). **(search wiring)**
- After `runCoach`, a `Workouts` row (keyed on `name`, §9) exists with matching `durationMinutes`/`intensity`; cleanup deletes it. **(coach persistence)**
- Suite skips cleanly when Bedrock is unset; persistence bullets additionally skip when Notion env is unset. **(coach seed / persistence)**

---

##### Preferences memory — `listPreferences` / `addPreference` / `removePreference` (`src/memory/preferences.ts`)

(Tests run against the real `src/memory/preferences.md`.)

- `listPreferences()` returns the file contents as a string, or `""` when the file does not yet exist. **(preferences memory)**
- `addPreference(text)` appends a new bullet; creates the file with a `# Preferences` header on first write; round-trips through `listPreferences`. **(preferences memory)**
- `addPreference(text)` is idempotent on exact-match — adding the same preference twice does not duplicate. **(preferences memory)**
- `removePreference(text)` removes a matching bullet; match is case-insensitive substring; only the first match is removed. **(preferences memory)**
- Tests restore the file (or delete the test-created one) after running. **(preferences memory)**

---

##### Orchestrator routing & preference-driven behavior (`src/orchestrator/orchestrate.ts`)

- **Preferences + profile read first, every run.** A `routeRequest` run begins with a `listPreferences` tool call and loads the Notion Profile before any sub-agent tool fires (verified via `steps` inspection). **(routing wiring)**
- **Correct spoke for a single-domain request.** `"What should my daily protein target be?"` routes to the nutrition tool and **not** to chef/secretary/coach (tool-call inspection). **(routing wiring)**
- **Chaining, in order, feeding forward.** The flagship request (§5.5) invokes nutrition → chef → coach → secretary in sequence within one run, and the synthesized reply is a single coherent message (verified via `steps.length` and tool-call order). This "just wiring" test is load-bearing — it stops a later tools-map refactor from silently dropping a spoke (§15.3). **(routing wiring)**
- **Explicit-only preference saves (§8, §3).** A message stating a taste rule (`"no cilantro"`) triggers an `addPreference` call within the run and is observable in `preferences.md` after; a message that merely *mentions* cilantro without instruction does **not** save a preference. **(preferences wiring)**
- **Preference actually applied — paraphrase-resistant.** After `addPreference` with a token-bearing rule (e.g. `"no cilantro"`), a chef run avoids `cilantro`/`coriander` in every recipe; after `"no workouts before 8am"`, a secretary run schedules no session starting before 08:00 on the Assistant calendar. **Do not** match on generic words the model could produce independently — assert the specific token/constraint so the test proves the preference drove the output. **(preferences wiring)**
- **No hallucinated rules.** A run with no matching preference does not invent one — output is shaped only by profile + request data. **(preferences wiring)**
- **Profile safety-critical restriction beats a stylistic preference on conflict (§8).** If a preference and a restriction disagree, the restriction wins. **(routing wiring / safety)**
- Suite skips cleanly when Bedrock (and, for the applied-preference bullets, Notion/Google) env is unset. **(routing wiring / preferences wiring)**

---

##### Safety rules (§11) — cross-cutting, non-negotiable **(safety)**

These get their own top-level describe blocks. The ones that don't need a live model run **unconditionally** (never inside `skipIf`); the LLM-dependent ones skip-with-warning but are never allowed to be the *only* evidence a safety rule holds.

- **Sub-BMR floor.** `computeTargets` never returns `dailyCalories < bmr` for any profile in the activity×goal table (asserted in the always-runs `nutrition method` tier above). **Always runs.**
- **Restrictions absolute.** The chef restriction test (paraphrase-resistant banned-ingredient tokens) and the nutrition `restrictionsEcho`-verbatim test together prove restrictions propagate and are never violated. A chef output containing a restricted ingredient is a hard failure that must trigger regeneration, never persistence (§14) — asserted by confirming no violating recipe reaches Notion.
- **Not medical advice.** For requests touching medical territory (pregnancy, eating disorders, diabetes, injury), the responsible agent sets `seeAProfessional: true` (Nutrition) or flags stop-and-see-a-professional (Coach) and does **not** diagnose or prescribe. Seed such a request and assert the flag + the absence of a numeric medical directive.
- **No extreme measures.** A `"lose 10kg in 2 weeks"`-style request is refused/reframed toward sustainable habits and never yields a sub-BMR target or a crash plan.
- **No body-shaming / negative self-talk reinforcement.** Framing stays supportive — asserted on a seeded self-critical prompt (the reply does not echo or amplify the negative framing).

---

#### 15.2 Test execution contract

The runner has three jobs beyond running tests: load the same env as runtime, make every skip visible, and never let "green" mean "skipped." This section is the contract — `package.json`, the test files, and CI all answer to it.

**Env loading — vitest sees the same env as runtime.**

`process.env.TAVILY_API_KEY`, the AWS Bedrock creds, `NOTION_API_KEY` + DB IDs, and the Google OAuth vars (§13) must be populated from `.env` **before** vitest starts, so real-API tests exercise the real API. The PRD bans `dotenv` (§12) — use Node's native flag in the `test` script:

```json
"scripts": {
  "test": "tsc --noEmit && node --env-file-if-exists=.env ./node_modules/vitest/vitest.mjs"
}
```

The `-if-exists` variant is intentional: CI without a `.env` still runs (integration suites skip with a warning); local with a populated `.env` runs the real-API suites. Plain `vitest` without this wiring sees the keys as `undefined` even with `.env` present, because Node does not auto-load `.env`.

**Type-check is part of green.** Vitest transforms via esbuild and ignores type errors entirely. Without `tsc --noEmit` chained ahead, type errors accumulate silently. The `ai@^5` `tool()` return-type narrowing case (§12) is canonical — vitest happily passes while `await searchWeb.execute!(...)` is typed as `T[] | AsyncIterable<T[]>`. The `&&` ordering is deliberate: types fail first (cheap, fast), then real-API tests run (slow, costly). A type error short-circuits before any Bedrock/Tavily/Notion/Google call fires.

**`npm test` is the only supported entry point.** `npx vitest` (or any invocation that bypasses the `test` script) skips Node's env-file flag and sees env vars as undefined. The observable-skip rule below catches this — the suite warns loudly rather than a false green — but the test still won't actually run. There is intentionally **no** `vitest.config.ts` setup-file that loads `.env` from inside vitest: loading `.env` is the npm script's job, so env-loading stays visible rather than hidden in a config file.

Quick verification anyone can run before trusting a green build:

```bash
node --env-file-if-exists=.env -e 'console.log(!!process.env.NOTION_API_KEY, !!process.env.AWS_ACCESS_KEY_ID)'
```

If that prints `false` in the same shell `npm test` runs in, the env-loading contract is broken regardless of what vitest reports.

**Test timeouts — 60s per test.** Set via the minimal `vitest.config.ts` at the repo root:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 60_000,
  },
});
```

Timeouts are the **only** thing `vitest.config.ts` does on this project. Env loading stays in the npm script so the env-loading contract lives in one place.

**Hook timeouts — real-API setup needs more than the 10s default.** `beforeAll`/`afterAll` hooks doing real-API work (seeding Notion rows, running one `routeRequest`/`runChef` to share across a suite, deleting linked records and calendar events) routinely exceed vitest's 10s default. The flagship-chained `beforeAll` — full orchestrator run across all four spokes — easily hits 90s+. Pass the timeout as a **per-hook argument**, not a global config knob, so the budget is visible at the call-site:

```ts
beforeAll(async () => { /* routeRequest(flagship) etc. */ }, 120_000);
afterAll(async () => { /* deleteMealPlanByWeek → deleteRecipeByName → deleteEvent */ }, 60_000);
```

Default budgets: `120_000` for setup hooks that run a full chained orchestration; `60_000` for cleanup hooks that only call MCP/calendar CRUD primitives. Ceilings, not targets — fast hooks still finish in milliseconds. `hookTimeout` is intentionally not added to config (same hide-behavior concern as the single-knob `testTimeout` rule).

**Observable skips — silent skip is a defect.** Any suite that skips because an env var is missing must `console.warn` at the top of the file (or in a `beforeAll`) naming the missing var:

```ts
if (!process.env.TAVILY_API_KEY) {
  console.warn('[skip] TAVILY_API_KEY unset — Tavily real-API suite skipped');
}
```

"Skips cleanly" everywhere in §15 means **warns-and-skips**, not silently skips. A reviewer or CI dashboard scanning output must see at a glance which suites did not run.

**Missing-env / always-runs tests run unconditionally.** An assertion that should fire *only when a var is missing*, but lives in a block that *also skips when that var is missing*, passes by being skipped — and the missing-env contract goes unverified. Observable skips catch silent skips of real-API suites, but a missing-env assertion inside `skipIf(!HAS_KEY)` looks like a passing test in the count with nothing to flag. The structural fix:

- **Missing-env and no-LLM safety assertions never sit inside `describe.skipIf(!HAS_KEY)`.** They live in their own top-level describe. This is doubly load-bearing here: the §11 safety invariants (`computeTargets` sub-BMR floor, restriction echo) belong to this always-runs tier.
- **Block-name convention: `<feature> — missing env (always runs)`** (and `<feature> — safety (always runs)`). The "always runs" suffix is visible at the suite level in vitest output, not buried in an `it` description.
- **Use vitest-native env stubbing.** `vi.stubEnv(NAME, '')` inside the test with `afterEach(() => vi.unstubAllEnvs())`. Do **not** `delete process.env.X` — its restoration semantics are runner-dependent and leave downstream tests order-sensitive.

Canonical pattern:

```ts
describe('Tavily — missing env (always runs)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('throws a clear, actionable error when TAVILY_API_KEY is missing', async () => {
    vi.stubEnv('TAVILY_API_KEY', '');
    await expect(searchWeb('q')).rejects.toThrow(/TAVILY_API_KEY/);
  });
});

describe('Nutrition — safety (always runs)', () => {
  it('never returns a sub-BMR daily target for any profile', () => {
    for (const p of PROFILE_TABLE) {
      const t = computeTargets(p);
      expect(t.dailyCalories).toBeGreaterThanOrEqual(t.bmr);
    }
  });
});

describe.skipIf(!process.env.TAVILY_API_KEY)('Tavily — real API', () => {
  // …real-API tests here; skip with a console.warn per the observable-skip rule.
});
```

The §15.1 per-feature bullets disambiguate which tests are subject to `skipIf`: bullets tagged "runs unconditionally per §15.2" and every **(safety)** bullet that touches only pure code go in an always-runs describe; the rest go in the real-API describe that skips with a warning.

**Definition of green for TDD.** A passing TDD cycle requires the test that was red to actually **execute against the real path**. A skipped test is **not green** — it is unverified.

- Read the vitest output, not just the exit code. `x passed, y skipped` with `y > 0` on the suite you just implemented is a **yellow flag**, not green.
- If the suite you intended to turn green is in the skip count, the env-loading contract is broken (or the key is genuinely missing) — fix that before claiming the cycle closed.
- Coverage of a §15.1 bullet requires the asserting test to have *run*. Skipped tests do not satisfy §15.1 — and a skipped **(safety)** test satisfies §11 not at all.

#### 15.3 The test is the spec for the change

In a no-mocks project, the integration test is the TDD layer — there is no unit-test scaffold to lean on. If a test would have failed before an edit and passes after, that test **is** the spec for that edit, even when the change is "just wiring."

- **A test that goes from red to green is the spec for that edit.** When `/tdd` is red, fix the code, not the test. The test pins the behavior; the implementation matches. An assertion that turns out to be wrong is edited **deliberately, in its own change, and surfaced** — never silently mutated to make `/tdd` green. This applies with special force to **(safety)** assertions: loosening a §11 test to pass is a spec change to the product's safety posture and must be called out as such.
- **"Just wiring" tests are spec tests.** The §15.1 bullet tagged **(routing wiring)** — "the flagship request invokes nutrition → chef → coach → secretary in sequence" — is the canonical example. Adding a spoke to the orchestrator's tools map looks like a one-line edit, but the test exists so the wiring cannot silently regress when someone later refactors the map. It is load-bearing, not ceremonial. The **(search wiring)** bullets (Nutrition/Coach invoke `searchWeb`) are the same shape.
- **§15.1 stage tags identify which bullet is the spec test at which stage.** A bullet tagged **(nutrition method)** is the spec test for the deterministic-arithmetic edit; **(chef persistence)** is the spec test for the Notion upsert edit; **(secretary seed)** is the spec test for the double-booking guard. Prompts that drive an implementation should cite the §15.1 bullet **for the stage being built** — not "all §15.1 bullets" — so the implementation cannot pull future-stage behavior forward.

§15.1 names every test the suite must contain. §15.3 names which one fires for any given change.


### 16. Acceptance criteria (v1)

- Asking for a nutrition target returns a valid `NutritionSchema` grounded in the profile, restrictions echoed, target never below BMR.
- "3 easy dinners under 30 min" returns a valid `MealPlanSchema`, honors restrictions and the "easy" caps, and writes Recipes + a grocery list to Notion.
- "Block prep time Sunday" creates an event on the **Assistant calendar** with no double-booking.
- "30-minute dumbbell workout" returns a valid `WorkoutSchema` written to the Workouts DB.
- The flagship chained request (§5.5) runs all four sub-agents in sequence with one synthesized reply — each persisting its own rows, blocks on the calendar.
- Stating a preference appends it to `preferences.md` with an acknowledgment; later runs visibly apply it.
- A restricted ingredient never appears in any chef output.
- All test suites pass against real services.

---

### Open decisions log — all RESOLVED

1. **Health profile home** — ✅ Notion **Profile** row = system of record; `preferences.md` complements with behavioral preferences (§8).
2. **"Easy meal" caps** — ✅ ≤ 30 min · ≤ 8 ingredients · common equipment only; per-request overridable (§5.2).
3. **Nutrition method** — ✅ Mifflin-St Jeor × activity factor · goal −15% / 0% / +10% · protein 1.6–2.2 g/kg · fat ≥ 0.6 g/kg · never below BMR (§5.1).
4. **Google Calendar** — ✅ OAuth desktop flow (refresh token) · dedicated Assistant calendar · create-on-request, read-before-write, delete-to-undo (§5.3, §10).
5. **Bedrock model + region** — ✅ **DEFERRED** by choice; placeholder constant, hardcoded later (§12).
6. **Notion DB shapes** — ✅ six databases pinned with exact properties + wrapper contract (§9).
7. **Write ownership** — ✅ each sub-agent owns writes to its own resource; orchestrator is a pure router (§7).
