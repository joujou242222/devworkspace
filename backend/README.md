# DevWorkspace

Multi-tenant agency software for LaunchFlow delivery management, OrbitSpace collaboration and Proofly version-specific client review.

**2026-10-19: Phases 1–8 accepted for documented local scope; Phase 9 full-system verification, recovery and hardening authorized.** See [Phase 9 report](docs/PHASE_9_REPORT.md), [Phase 9 evidence matrix](docs/traceability/PHASE_9_EVIDENCE.md), [36-page action inventory](docs/traceability/PHASE_8_ACTIONS.md) and [feature ledger](docs/traceability/FEATURE_MATRIX.md). Stop at the Phase 9 review gate; Phase 10 professional design requires separate authorization.

Development uses native Windows PostgreSQL, Memurai, SeaweedFS and Mailpit, without Docker or WSL. Preserve the retained PostgreSQL cluster, ignored credentials and all uncommitted work. Compose remains optional; native evidence never claims Docker execution.

## Run the product locally

Use pinned Node **24.14.0** and pnpm **10.18.1**. From this repository:

```powershell
pnpm native:up
pnpm phase2:prepare
pnpm build
pnpm dev
```

For missing dependencies/configuration only, use `pnpm install --frozen-lockfile` and `pnpm setup:local` first. Do not reinitialize the existing PostgreSQL cluster. [The native runbook](infra/README.md) documents ownership checks, exact tools, private credentials, lifecycle, mail retry and migration recovery.

Open [DevWorkspace](https://localhost:8443). Register, open the real verification message in local [Mailpit](http://127.0.0.1:8025), verify through the page, then sign in. Create an organization or accept an intended invitation. Onboarding, invitation acceptance and ownership changes require signing in again because privilege transitions revoke the old session. Use the organization selector to open settings, Team, Dashboard, Clients, Projects and My Tasks. Project navigation exposes milestones, task checklists, internal threads/history, documents, files, deliverable versions, review workspaces, activity and team/access. Client invitations grant only the explicitly selected contact/project capacity; the portal exposes only granted projects and shared material. Account supports display name, password, session management, profile image and notification preferences. See the [36-page action inventory](docs/traceability/PHASE_8_ACTIONS.md) for scope and limits.

Self-signed TLS is project-local. No certificate trust is installed in Windows; ordinary browsers show a certificate warning. Automated browser trust is scoped to their isolated context. Use disposable credentials. Secrets, database files, proof links, mail envelopes and logs remain ignored. Mailpit is a local catcher, not an external mail relay.

`pnpm dev:stop` stops only ownership-checked app processes. `pnpm native:down` separately stops the owned native services and PostgreSQL while retaining data. Product migrations add `devworkspace_phase2`; they do not modify or reset `devworkspace_v01`.

## Verify

With the product stack running:

```powershell
pnpm check
pnpm build
pnpm test:phase2
pnpm test:phase3
pnpm test:e2e
pnpm test:e2e:phase3
pnpm test:phase4
pnpm test:e2e:phase4
pnpm phase2:mail-status
```

`check` covers pinned runtime, AST/manifest boundaries, documentation, static optional Compose configuration, OpenAPI/generated client drift, environment checks, lint, TypeScript, unit tests and formatting. `test:phase2` uses real HTTPS/NestJS/PostgreSQL/Redis/BullMQ/SMTP and restricted roles. `test:e2e` runs the actual Phase 2 browser journey. Generated browser-safe contracts and the OpenAPI snapshot describe identity, tenancy and core-domain operations plus health routes. Generate with `pnpm openapi:generate` after building contracts.

The accepted Phase 1 experiment remains reproducible in a separate mode:

```powershell
pnpm dev:stop
pnpm dev:experiment
# In another terminal:
pnpm test:integration
pnpm test:e2e:experiment
```

Its screen is `/foundation`; its auth experiment is `/experiment`. Product APIs are disabled in experiment mode, and the raw experimental auth handler is disabled in product mode. `pnpm experiment:prepare` is only for separately initializing the disposable V01 experiment in a new checkout; it is unnecessary on this retained installation and must never target product tables.

`pnpm test:native` requires the application to be stopped because it restarts PostgreSQL and proves native service persistence. It touches only its own synthetic probes. For missing pinned Chromium, install it only in the project:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD/.local/browsers"
pnpm exec playwright install chromium
```

## Product and architecture baseline

All **36 templates = 29 core + seven expansion** remain required. Follow backend-first, functionality-complete, design-later, with a minimal working UI in each slice. The modular monolith and dependency pins are retained. Tenant queries use transaction-local RLS and live selected-principal policy; global identity and dispatch have narrow reviewed interfaces. Phases 3–9 still govern domain, files, immutable exact-version review, notifications, collaboration and full system verification. No phase advances automatically.

| Document | Purpose |
| --- | --- |
| [Engineering instructions](AGENTS.md) | Boundaries and current authorization |
| [Product specification](docs/PRODUCT_SPEC.md) | Roles, all 36 templates and acceptance criteria |
| [Architecture](docs/ARCHITECTURE.md) | Decisions D01–D22 and validation gates |
| [Data model](docs/DATA_MODEL.md) | Ownership, integrity and lifecycles |
| [Security](docs/SECURITY.md) | Sessions, authorization, RLS and threats |
| [Implementation plan](docs/IMPLEMENTATION_PLAN.md) | Phase scope and review gates |
| [Testing](docs/TESTING.md) | T01–T25 and traceability |
| [Phase 1 report](docs/PHASE_1_REPORT.md) | Historical auth compatibility evidence |
| [Native infrastructure report](docs/PHASE_1_NATIVE_INFRASTRUCTURE_REPORT.md) | Accepted native Phase 1 evidence |
| [Dependency versions](docs/DEPENDENCY_VERSIONS.md) | Pins and provenance |
| [Phase 2 report](docs/PHASE_2_REPORT.md) | Product implementation, verification and limits |

Phase 4/5/6 integrations: Project Files/Deliverables support private uploads, previews/downloads and immutable version history; Account and organization settings support processed image attachment/removal. Review Center/client portal support exact-version review, image/PDF annotations, formal decisions and internal feedback conversion. Notifications and self-owned assignment/review preferences use persistent APIs with authorized socket hints and REST catch-up. Retained [Phase 4](docs/PHASE_4_REPORT.md), [Phase 5](docs/PHASE_5_REPORT.md) and [Phase 6](docs/PHASE_6_REPORT.md) evidence/runbooks preserve their limitations.

## Expansion workflows

Reports, internal project discussions/activity, the document library/visual editor and Owner/Admin audit browser use real scoped APIs. Project overview publishes/withdraws client updates; the portal Updates page aggregates only currently authorized publications and shared review milestones. Account includes discussions/documents and client-update preferences. Run `pnpm test:phase7`, then `pnpm test:e2e:phase7` against the product stack. The latter consumes only ignored synthetic fixtures from the former. See the Phase 7 report for actual results and limits.
