# Phase 3 implementation and verification report

Date: 2026-10-16, Africa/Cairo. Workspace: `D:\Devworkspace`.

**Exit status: PASS for the approved Phase 3 scope. Ready for user review; Phase 3 is not accepted on the user's behalf.** Phases 1 and 2 were accepted and full Phase 3 was explicitly authorized in the attached request. Stop at this review gate. Phase 4 and professional design remain unauthorized. No commits, pushes, deployments, dependency upgrades or destructive database operations were performed.

## Completed feature matrix

| Scope / pages              | Completed functionality                                                                                                                                                                                | Evidence                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| FR03 / P11-P12             | Persistent client/contact create, read, edit, lifecycle, scoped discovery and related projects; archive conflict with active projects                                                                  | Phase 3 API cases; owner browser journey                                                |
| FR04 / P09/P16/P23         | Client-qualified projects, explicit internal roles, eligible candidates, access changes, metadata/deadlines, lifecycle/reopen/archive, pagination and scoped aggregates                                | API authorization/lifecycle/race cases; owner browser                                   |
| FR05 / P19/P18             | Milestones, ordering/deadlines, explicit completion, same-project task links and automatic reopen on unfinished work                                                                                   | API completion/ancestry/held-lock race; owner browser                                   |
| FR06 / P10/P17/P18         | One eligible project assignee, task priority/status/deadline/order, filters, My Tasks, checklist structure/toggle/remove, separate checklist progress, internal roots/replies and actor/change history | API policy/filter/CAS/revocation/rollback cases; both new browsers                      |
| FR04/FR06 / P08/P16        | Accessible project counts/progress, upcoming/overdue assigned work, client/milestone summaries and scoped links                                                                                        | API aggregation/isolation; owner browser                                                |
| FR01/FR11 / P06/P12/P23    | Real encrypted client invitations and mail, target review, intended-identity acceptance, expiry/revocation/replay, separate client principals and explicit same-client project grants                  | Actual SMTP/API tests; client browser; owner invite/revoke browser                      |
| FR02/FR19 / P13 extension  | Existing membership management now atomically clears active project task assignments on deactivation; later requests fail live authorization                                                           | Phase 3 deactivation case and rerun Phase 2 suite                                       |
| FR17/FR19/FR20 / all above | Strict DTOs, tenant/project/task ancestry, forced RLS, live principal/field/state policy, revisions, atomic history/audit/outbox and recoverable minimal interfaces                                    | Restricted SQL, fresh migrations, rollback/race tests, build/check and browser evidence |

Detailed action-to-operation/policy/invariant/test mappings are in [FEATURE_MATRIX.md](traceability/FEATURE_MATRIX.md). All 36 product templates remain required. Later portions of shared FR/page IDs are explicitly deferred rather than claimed complete.

## Modules and API inventory

`packages/server/src/core.ts` contains Clients, Projects, Access and Work policies/use cases, explicit DTO projections and scoped reads. `client-access.ts` handles client principals, access inspection and invitation issue/listing. `organizations.ts` retains the tenant transaction/session boundary and extends verified invitation acceptance. `product.ts` routes through these services; existing Nest controllers remain thin. The worker reuses the existing durable encrypted mail/delivery lane.

There are **43 added operations**, making **68 product operations**, plus the two health routes. Exact operation IDs, strict request schemas and generated response/client types are in `packages/contracts/src/operations.ts`, `phase3.ts`, `client.generated.ts` and `openapi.json`.

| Operation group                                       | REST path suffix under `/api/v1/organizations/{organizationId}`                           |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `clientsList/Read/Create/Update`                      | `/clients`, `/clients/{resourceId}`                                                       |
| `contactsList/Read/Create/Update`                     | `/clients/{clientId}/contacts`, child ID                                                  |
| `projectsList/Read/Create/Update`                     | `/projects`, `/projects/{resourceId}`                                                     |
| `membersList/Read/Create/Update`, `projectCandidates` | `/projects/{projectId}/members`, child ID; `/candidates`                                  |
| `grantsList/Read/Create/Update`                       | `/projects/{projectId}/grants`, child ID                                                  |
| `milestonesList/Read/Create/Update`                   | `/projects/{projectId}/milestones`, child ID                                              |
| `tasksList/Read/Create/Update`                        | `/projects/{projectId}/tasks`, child ID                                                   |
| `checklistList/Read/Create/Update/Remove`             | `/projects/{projectId}/tasks/{taskId}/checklist`, child ID                                |
| `commentsList/Create`, `historyList`                  | Same task's `/comments`, `/history`                                                       |
| `dashboard`, `myTasks`                                | `/dashboard`, `/my-tasks`                                                                 |
| `clientInvitationCreate`, `clientInvitationsList`     | `/clients/{clientId}/contacts/{contactId}/invitations`; `/clients/{clientId}/invitations` |
| `clientAccessRead`                                    | `/client-access`, selected contact principal and cursor                                   |
| `clientPrincipalsRead`                                | Global self route `/api/v1/me/client-principals`, with cursor                             |

Existing `invitationInspect`, `invitationAccept` and `invitationRevoke` also serve immutable client targets. PATCH and scoped DELETE require revisions. Assigned Contributor task/checklist writes have narrower union DTOs. CRUD has no invented idempotency requirement; onboarding/invitation acceptance retain their mandatory scoped keys/receipts. Unsupported verbs/nesting and overposted ownership/source/role fields are rejected. Core snake-case fields are explicit public DTO names, not serialized ORM records.

## Database migrations, RLS and recovery

| Additive migration       | Implemented protections                                                                                                                                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0010-core.sql`          | Ten core tables, composite tenant/project/client/task FKs, uniqueness/checks, positive revisions, forced RLS, runtime grants, append-only comments/history, immutable parents, assignment and completion backstops, scoped indexes |
| `0011-client-access.sql` | Forward repair of polymorphic trigger field access; internal/client invitation target shape, explicit contact/project/role, separate pending uniqueness, narrow NOLOGIN client-principal resolver                                  |
| `0012-core-bindings.sql` | Immutable new invitation targets, linked-contact email protection and contact deactivation revoking grants/pending invitations                                                                                                     |

The ten tables are `client`, `client_contact`, `project`, `project_membership`, `client_project_access`, `milestone`, `task`, `task_checklist`, `task_comment`, `task_history`. All use FORCE RLS and transaction-local tenant context. Mutable rows retain UTC creation/update times and revisions. Prisma includes scalar mappings; reviewed SQL owns FKs/triggers/RLS. Runtime API remains nonowner, nonsuperuser, NOINHERIT and NOBYPASSRLS; it gains no identity-table, migration or DDL authority. Resolver privileges are explicit and restricted to reviewed functions. Identity/worker roles cannot query the new domain.

The existing preparation command was retained for compatibility: `pnpm phase2:prepare` verifies earlier checksums and applies only missing migrations. It succeeded again after implementation. `devworkspace_phase2`, `devworkspace_v01`, their records and native service data were retained. Fresh-schema tests applied all migrations to uniquely named validation databases, retained for inspection. No applied migration was rewritten. Recovery remains forward-only with private credential/mail-key preservation; full backup/restore rehearsal remains Phase 9.

## Authorization, lifecycle and concurrency

Owner/Admin manage tenant clients/projects. Members discover only explicitly assigned projects and associated limited client summaries. A Manager administers their project's work/participation and same-client grants, without organization-wide client/contact/team authority. Candidate and grant details require management permission. Owners/Admins also need an explicit eligible project membership before receiving a task assignment.

Managers administer task metadata/priority/assignment/deadlines/order, milestone state and checklist structure. Only the currently assigned active Contributor changes working states/DONE and toggles checklist completion. Other Contributors may post internal threads/replies; Viewers read. CANCELLED and administrative fields are Manager-only. Even cancelled task creation cannot use an ineligible assignee. Internal membership removal or project-role downgrade clears active assignments with history/audit/events; historical completed assignments persist, and reopening requires eligibility or explicit clearing.

External contacts use a separate selected principal. Verified acceptance links only the intended contact and proposed project grant; it never creates Membership. Each client invitation proposes one project; additional projects require another explicit grant/invitation. Internal invitations continue to establish organization membership, followed by explicit project participation. Contact affiliation alone grants nothing. Current issuer/contact/project/expiry/revocation/consumption are checked, and matching receipt replay reauthorizes the actual grant. Client access inspection returns only explicitly granted portal-enabled project name/identity/status/role. Clients cannot read internal tasks, comments, history, client administration or team data. Full portal/review content remains Phase 5.

Project completion requires all noncancelled tasks DONE; new work in a completed project needs explicit reopen. Archive retains authorized history and blocks content writes. Access revocation remains possible on closed projects. Milestone completion is explicit and requires linked noncancelled work DONE; unfinished additions/reopening reopen the milestone atomically. Project and milestone progress is DONE/noncancelled, null for no eligible tasks. Overdue excludes done/cancelled work; checklists remain independent.

All API core operations share the existing organization-row serialization boundary with session/principal revalidation. Held-lock tests wait until both independent API transactions block, then release them: task/item CAS has one winner; assignment versus downgrade leaves no ineligible active task; milestone completion versus reopening and project completion versus new work preserve invariants. Sensitive audit includes selected principal/capacity and previous/new access role/state, without content/proofs. Audit/outbox failure injection rolls back domain/history/audit facts together.

## Minimal frontend and actual browser flows

The existing Next.js application now serves P08-P12, P16-P19 and P23 through `apps/web/app/core.tsx` and `w/[orgId]/[[...core]]/page.tsx`. Existing `flows.tsx` extends P06 and Account with separate client capacity inspection. P13 deactivation has real project/task effects. There is no decorative operation, mock API, new design system or production demo data.

Interfaces include accessible named forms, loading/empty/denied/session/conflict states, explicit reload and persisted filter URLs. Failed saves retain input; explicit stale-data reload fetches current revisions. Pending checklist changes reflect the click and roll back on failure. Revoked/unavailable reads hide the previous view. Task history exposes actors/timestamps and expandable changed fields. Dates use the browser's local display; API storage is UTC.

The owner browser covers client/contact/project/milestone/task persistence, priority/filter reload, checklist, internal roots/replies/history, stale save retaining input and recovery, participation, invitation SMTP/revocation, My Tasks and dashboard. The separate-role journey covers assigned Contributor work/checklist updates, Viewer read-only controls, displayed client/project invitation target, client acceptance/capacity inspection and internal-route denial. Existing Phase 2 and foundation browser journeys were also rerun successfully.

## Commands and actual results

All commands ran from `D:\Devworkspace` on the retained pinned native Windows stack. No Docker/WSL, package upgrade or mock persistence was used. Source/binary pins remain as documented in the prior accepted reports and native manifest; no new production compatibility claim is made.

| Actual command                                        | Final result                                                                                                                            |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm phase2:prepare`                                 | Exit 0; checksummed additive inventory through 0012                                                                                     |
| `pnpm build`                                          | Exit 0; Prisma generation and all web/API/worker/packages                                                                               |
| `pnpm check`                                          | Exit 0; runtime, AST boundaries, docs, static optional Compose, generated contracts, environment, lint, types, 9 unit tests, formatting |
| `pnpm test:phase3`                                    | Exit 0; **27/27** real API/database/security/concurrency cases; no skips                                                                |
| `pnpm test:phase2`                                    | Exit 0; **20/20** product regression cases rerun; no skips                                                                              |
| `pnpm test:integration`                               | Exit 0; **20/20** legacy auth/Socket.IO/HTTPS cases in explicit experiment mode; no skips                                               |
| `pnpm test:native`                                    | Final exit 0; **7/7**, including owned restart and retained SQL/queue/S3/mail fixtures                                                  |
| `pnpm test`                                           | Exit 0; **9/9** unit checks, also included in `check`                                                                                   |
| `pnpm test:e2e:phase3`                                | Exit 0; **2/2** new real browser journeys                                                                                               |
| `pnpm test:e2e`                                       | Exit 0; **1/1** existing Phase 2 browser journey                                                                                        |
| `pnpm test:e2e:experiment`                            | Exit 0; **1/1** retained foundation browser journey                                                                                     |
| `pnpm openapi:check`, `pnpm lint`, package typechecks | Exit 0; also included in final aggregate check                                                                                          |
| `git diff --check`                                    | Exit 0; only Git line-ending normalization warnings                                                                                     |
| Owned `dev:stop`, `dev:experiment`, final `dev`       | Exit 0 for stops; both modes reached readiness; final product mode left running at `https://localhost:8443`                             |

Counts are separate suites, not substitutes for one another. Historic results were not reused as new passes. The focused command/outcome record is [phase3-final.txt](verification/phase3-final.txt).

## Discovered failures and applied corrections

- The initial API run was 13/14: reply creation requested a write lock on an append-only comment table whose runtime role intentionally lacks UPDATE. Use an immutable parent read; the real reply case passes.
- Phase 2's login-return allowlist did not cover new domain routes. Extend only exact same-origin approved paths and add redirect-injection unit checks.
- Browser checks exposed label text incorporating select options or persisted textarea content, pending checklist clicks reverting visually before the response, transient create forms while loading a detail, omitted roster role/target display, and stale reload interactions. Explicit accessible names, pending-state handling, loading/failure boundaries and real metadata/target presentation corrected these; both full journeys pass.
- Source review found wrong-verb CRUD fallthrough and a cancelled-task assignment eligibility bypass. Explicit operation shapes and eligibility checks now reject both, with regressions.
- Test corrections included importing the local mail helper, waiting for completed login/persistence before the next action, and replaying the actual winning acceptance key. Assertions were retained and expanded with held-lock races, stale recovery and real invitation revocation.
- An initial native restart run exited 1 after interruption/closed Redis, leaving a stale lifecycle lock. Verified no live lifecycle process, removed only that exact stale lock and restored owned services. A subsequent complete run passed 7/7 in about 45 seconds. No infrastructure/data reset or unsupported forced shutdown was used. The initial failure is retained as an operational limitation; no unproven deterministic root-cause fix is claimed.
- Intermediate aggregate checks caught traceability formatting and an unused audit metadata parameter. Formatting was corrected; the metadata is now persisted and verified by an explicit audit assertion. Final build/check pass.

## Changed files and preservation

The original workspace contained staged additions and untracked Phase 2 work. No clean baseline commit was assumed. Existing work was preserved; no reset, clean, destructive checkout, commit or push occurred. No original database/native data, secrets or migration ledger was removed. SQL failure-injection objects were scoped to synthetic test organizations and removed in test cleanup; existing data remained intact. Prior migration digests were reverified. No package version or lockfile upgrade was introduced.

A final source inventory with hashes is [phase3-files.json](verification/phase3-files.json). It is a final-state inventory, not a claim of a pre-edit hash comparison. Changed source areas are AGENTS/README/current-gate docs; root test scripts; core/access services and the existing product/organization adapter; contracts/OpenAPI generator/generated client; additive SQL and product Prisma scalar models; minimal landing/workspace/invitation/account UI; new integration/unit/browser tests; documentation checker, traceability and native runbook. Build may refresh Next.js's generated type-reference file. Existing Phase 1/2 source and tests remain present.

Diff/source review checked field allowlists and DTO projection, constant-table SQL identifiers, tenant-qualified predicates/relationships, live role/state checks, mutation/event atomicity and the absence of later-phase endpoints or dependency changes. Documentation checks retain exactly 36 templates, 29 core/seven expansion and valid links.

## Limitations and known risks

- Organization-wide serialization favors correctness and can limit same-tenant throughput. Related minimal-UI collections load in bounded API pages but are eagerly assembled; production-scale load/performance work is not certified.
- Native development shares the Windows user's filesystem boundary. The initial lifecycle interruption means an operator may still need the documented stale-lock inspection after an interrupted command. No production deployment or full backup/restore claim is made.
- SMTP can duplicate after ambiguous send completion, as already documented in Phase 2. Proofs remain one-time/expiring and effects do not confer reusable rights.
- UI styling is intentionally minimal and replaceable. Phase 3 tests do not satisfy later file-processing, exact-version decision, notification, expansion, full-system or professional design gates.

There is no known unresolved mandatory Phase 3 functionality or verification failure in the final runs. User acceptance remains required before advancing.

## Deferred work and exact next recommendation

**Stop here for Phase 3 review. Do not start Phase 4 automatically.** After explicit Phase 3 acceptance and Phase 4 authorization, implement the approved private files/flat folders/quarantine and processing, immutable deliverable versions, optional same-project task linkage, scoped organization/profile media and V03/V05 evidence. Formal review/approval/annotations and the complete client portal remain Phase 5; notifications Phase 6; all seven expansion templates Phase 7; full cross-system verification and professional design remain at their later gates.
