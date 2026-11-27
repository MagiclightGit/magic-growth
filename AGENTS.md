# Working conventions

## Engineering & architecture boundaries

- Node 24 and pnpm are required. Use the committed lockfile. Run commands from the workspace root (macOS Homebrew Node 24: `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`).
- `apps/web` owns browser UI. Never import database, provider credentials, Nest modules or Worker code into it. Browser traffic uses `/api` via the Vite proxy locally and a same-origin reverse proxy in deployment.
- `apps/api/src/modules` is organized by business capability. Controllers validate contracts, guards enforce permissions, services own business transactions. Put shared infrastructure in `platform`, not in a growing catch-all utilities module.
- `packages/contracts` contains browser-safe validation and transport types; `packages/database` owns Drizzle schema/migrations; `packages/agent` owns AI SDK execution. Apps may consume packages; packages must not import apps.
- Keep UI primitives in `components/ui`, AI Elements in `components/ai-elements`, and domain pages in `features`. Prefer lazy feature routes and TanStack Query for server state.
- Auth is Better Auth email/password with public signup disabled. Only admins provision members. Validate writes, role checks, and dynamic product grants on the server even when UI hides controls. Never let model output grant permissions or mark evidence verified.
- Background runs belong in Worker and must be persisted. Browser requests enqueue work and return; do not tie long research to a request or an open tab.
- No seeded business metrics or simulated successful integrations. Preserve empty/unconfigured/failure states and identify what was actually verified.
- Change schema with `pnpm db:generate`, review and commit the SQL, then `pnpm db:migrate`. Do not use schema push against shared databases.

## UI & modern B2B office design contract (`apps/web`)

- Follow `docs/design-system.md` strictly for all frontend additions and polish.
- Use the defined semantic tokens in `apps/web/src/styles/globals.css` (cool neutral canvas `#F5F6F7`, crisp white surfaces `#FFFFFF`, office blue primary `#3370FF`, semantic `Badge` variants `info` / `success` / `warning` / `danger` / `neutral`). Never leave all business statuses as monochrome `outline` badges.
- Keep density tuned for internal team operations: `h-8` standard controls, grouped sidebar navigation, underline view tabs, white `FilterBar`, and `Table` for high-frequency lists (intelligence, tasks).
- Avoid "AI demo" anti-patterns: no decorative 4-card KPI hero walls without direct queue actions, no marketing split-screen login pages or uppercase English slogans, no giant dashed empty boxes (`min-h-64 border-dashed`), and no stacked full-width large cards for dense operational lists.

## AI-native development & Feishu-driven workflow

- Before coding a new feature or bugfix from Feishu/PRD, align acceptance criteria against `docs/templates/feature-spec.md` (main flow, `admin`/`operator`/`viewer` + product-grant isolation, edge/failure states, persistence/revision conflict behavior, and UI checklist). If business rules are ambiguous, surface explicit options for human sign-off before implementing.
- Run `pnpm env:check` before starting verification or debugging environment issues.
- For parallel agent work, isolate branch, directory, and ports with `pnpm worktree:init <task-slug> --slot <1..9>` instead of editing the shared checkout or colliding on ports `5173`/`3001`.
- Feishu group intake & thread progress sync follow `docs/ai-native-workflow.md` via `pnpm feishu:intake`. Never claim Feishu automation is live unless real bot auth and group events were actually verified.

## Verification gates & review evidence

- Run `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and `pnpm test` for every change.
- Integration scripts (`pnpm test:smoke`, `test:workflow`, `test:intelligence`, `test:products`, `test:market-watch`, `test:competitor-research`, `test:conversations`) require local migrated PostgreSQL, Redis, API and Worker; they create and clean temporary fixtures. Never run them against production.
- For frontend/UI changes, deliver review evidence covering: (1) verification URL & test account role, (2) code diff & passing check commands, (3) desktop (1440×900) and mobile (390×844) screenshots generated via `pnpm verify:ui` (when Playwright is installed and local/staging server is running) or explicitly note why browser capture was skipped.
- Update `TODO.md` and relevant `docs/*.md` when delivered scope or setup changes. Do not mark a broad task complete when only its foundation is implemented.
