## CLAUDE.md

You're helping build the **Personal Health & Lifestyle Assistant** — a console agent where an orchestrator (hub) routes plain-English requests to four sub-agents (spokes): a nutrition specialist, an easy-meals chef, a Google-Calendar secretary, and a sport coach. State lives in Notion; events live in Google Calendar; fresh info comes from Tavily search.

This file is **working agreements** — rules that fire every prompt. The full spec lives in PRD.md and is the source of truth. If a request contradicts the PRD, ask before deviating.

### PRD jump table

| Topic | PRD section |
|---|---|
| Locked decisions (stack, routing, scope) | §0 |
| Repo layout & naming conventions | §1.2 |
| Architecture, routing, loop boundary | §4 |
| Sub-agent specs (nutrition method, easy caps, calendar policy) | §5 |
| Zod schemas & write ownership | §7 |
| Memory model (Profile vs preferences.md) | §8 |
| Notion DB shapes & wrapper contract | §9 |
| Google Calendar integration | §10 |
| Safety & wellbeing rules (load-bearing) | §11 |
| Dependencies & version pins | §12 |
| Config & secrets | §13 |
| Error handling matrix | §14 |
| Testing strategy | §15 |
| Acceptance criteria | §16 |

### Installs

Never run `npm install <pkg>` without a version range — defaults silently bump pinned majors (a fresh `npm install ai` resolves to `ai@6`, the wrong tree). Consult PRD §12 before adding any dependency. The "Do NOT install" list there is load-bearing.

### PRD vs code disagreements — PRD wins on names

When PRD spec and existing code disagree on a name (sub-agent export, Notion table, property, wrapper, symbol), the PRD wins. Don't silently follow the code to "avoid mid-feature renames" — surface the drift, then either fix the code to match the PRD or update the PRD if the code is correct. Resolve in place; don't paper over.

### Safety rules are non-negotiable

PRD §11 rules (restrictions/allergies are absolute, never below BMR, no crash diets/over-training, not medical advice, supportive framing) fire in every sub-agent prompt. A restricted ingredient in chef output or a sub-BMR calorie target is a **hard failure**, not a soft preference — reject and regenerate. Never weaken a §11 rule to satisfy a request.

### TDD with real services

Write the failing test first, implement to green, refactor. Tests hit real Tavily, the real Notion base, the **dedicated Assistant Google Calendar**, and the real preferences.md — no mocks. Run `/tdd` after every meaningful change: green → suggest a commit, red → fix before moving on. The full test contract (skip visibility, missing-env handling, cleanup, "test is the spec") lives in PRD §15.

Before claiming a TDD cycle green, re-read the PRD sections that govern the files you touched (jump table above). Drift that survives `/tdd` is drift that survives forever.

### Real-service cleanup — order matters

Tests that write must clean up after themselves via the `delete<Table>By<Key>` Notion helpers and `deleteEvent` for calendar rows (PRD §9, §10) — never by re-discovering MCP tool names inline. Delete linked children (e.g. Meal Plan → Recipes relations) before parents. Calendar tests run only against the dedicated Assistant calendar so cleanup can never touch real events. Verifier and cleaner are different code paths — don't assert on a delete helper's return count.

### TDD report style — terse by default

When the result matches what TDD predicts, say so in one sentence and stop:
- Red as expected: "Tests fail as expected — <one-line reason>."
- Green as expected: "Tests pass as expected."

Explain only when the result is NOT what TDD predicts (red when green was expected, green when red was expected, or a load-time/compile error instead of a normal assertion failure). Then say what's off.

If you touched a file outside the one under test, name it in one line so scope creep is visible. No file-by-file changelog, no "and here's why I added X" recap — the user reads the diff.

### Cross-stage test prevention

When implementing tests from a PRD spec block that spans multiple build stages, only implement tests whose dependencies already exist in the codebase. If a test asserts on a field, function, or behavior from a later stage, skip it and surface — don't write a test guaranteed to fail because the upstream code doesn't exist yet. Prompts that name "every bullet" of a test section are a smell: they collapse staging into one shot. The natural build order is leaf-first: `searchWeb` (Tavily) → the Notion/Calendar wrappers → each sub-agent → the orchestrator that chains them.

### Pause and confirm before
- Destructive shell commands (`rm -rf`, `git reset --hard`, `git push --force`, deleting non-test Notion rows or non-Assistant-calendar events).
- Editing the PRD or any system prompt at `src/**/prompts/*.md` — these are load-bearing (routing, the §11 safety rules, the pinned nutrition method).
- Adding a new dependency, **or bumping the major version of an existing one** (e.g. `ai@5` → `ai@6`, `vitest@3` → `vitest@4`). Major bumps are PRD changes, not implementation choices.
- Editing version ranges in package.json for any reason. The pins map to the API surface the codebase and prompts are written against.
- Refactoring mid-feature — finish the feature first.

Default to small, reversible changes. One-time permission ≠ blanket authorization.

### Commits & secrets
- Commit after every green test cycle. Small commits beat big ones. Messages explain _why_, not what.
- `.env` is in `.gitignore`. Never `git add` it. If `.env` shows up in `git status`, stop and check `.gitignore` first.
- Never `git add -A` blindly when there are untracked files.
- Secrets (AWS Bedrock creds, Tavily, Notion, Google OAuth tokens — PRD §13) never appear in code, commit messages, terminal output, or test output. If the user pastes a secret in chat, treat it as compromised and tell them to rotate.

### When you're stuck
- Re-read the relevant PRD section (jump table above).
- Run `/tdd`. The failure message often tells you what's wrong.
- Re-run the failing command and read the streaming `[orch]` / `[nutrition]` / `[chef]` / `[secretary]` / `[coach]` lines — they show what each agent actually decided.
- Ask before structural changes (new folders, dependencies, schema changes).

### Evolving this file

When you discover a working agreement that should fire every prompt, propose adding it here — not the PRD. When you discover a spec change (schema, error matrix, test requirement), propose adding it to the PRD — not here. Keep this file under ~90 lines.
