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

Carried from the reference: **TDD throughout** · **real services, not mocks** (real Tavily, real Notion base, the dedicated test Google Calendar, real preferences file) · **skip cleanly but loudly** when keys missing · **tests clean up after themselves** (delete created Notion rows via the `delete<Table>By<Key>` helpers and calendar events via `deleteEvent`, restore the memory file) · **type-check is part of green** (`tsc --noEmit && vitest`). Per-feature coverage list (`§16.1`-style bullets tagged by build stage) is written during TDD once each wrapper lands. Order matters for any linked rows (delete children before parents), and the dedicated Assistant calendar guarantees cleanup can never touch real events.

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
