# Implementation plan and phase gates

## Current authority, 2026-10-19

Current authority, 2026-10-19: Phases 1–8 are accepted for their documented local-development scope. On 2026-10-19 the user explicitly authorized complete Phase 9 full-system verification, recovery and hardening. Preserve prior storage, AppContainer/ACL, cleanup and operator-recovery limitations. Stop at the Phase 9 review gate; Phase 10 professional design requires separate authorization.

Status, 2026-10-16: the user accepted Phase 1 under the Native Windows criteria and explicitly authorized the full Phase 2 scope below. Phase 2 implementation and verification are recorded in [PHASE_2_REPORT.md](PHASE_2_REPORT.md). Stop at the Phase 2 review gate. Phase 3 and later remain unauthorized; professional design remains deferred. Earlier Phase 1 gate wording below describes the original authorization boundary.

## Delivery rules and dependencies

Use backend-first vertical slices: define policy/invariants/contracts, implement transactional use cases/persistence, verify them, then connect a thin Next.js UI during that same phase. Do not defer all UI or integration tests to Phase 8. Avoid production mock APIs and fabricated seed data; deterministic synthetic records are allowed in isolated tests.

Phases 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 are dependency ordered. Outbox/audit/security begin with the first relevant mutation, not with their later browser/reporting pages. New functionality must preserve earlier working flows. Pages can receive later module integrations; they are not complete until their full approved acceptance criteria pass.

## Phase 0 — Architecture and repository inspection

Scope: inspect initial files/repository status; create the eight requested planning files; define all 36 templates, 20 functional requirement groups, role/resource policies, data invariants, candidate architecture, validation risks, and evidence process.

Exit gate:

- All eight files exist and agree on 36 templates = 29 core + seven expansion.
- Each page has route, actions, permissions, states, dependencies, and acceptance criteria; each feature has traceability to verification scenarios.
- Documentation links/IDs/phase coverage and whitespace are checked with recorded results. Run `git diff --check` only if Git exists.
- User reviews the reconciled baseline, including any-one Approver policy retained, deliberate replacement instead of supersession on preparation, optional task linkage, restored task/folder/rich-text/media/preference/update scope, concrete single-origin storage routing and remaining defaults.

Evidence: documentation checks only, no application test claims. The documentation work can be complete while baseline approval remains pending. **Stop after this task.**

## Phase 1 — Repository foundation and compatibility

Prerequisite: explicit approval of the baseline and Phase 1 scope.

Scope:

- Initialize a pnpm monorepo with minimal `apps/web`, `apps/api`, `apps/worker` and shared package boundaries from the architecture. If Git initialization is authorized as part of this phase, initialize locally; no commits/pushes without separate authorization.
- Research and pin mutually supported stable Node.js/pnpm/TypeScript/Next.js/React/NestJS/Prisma/auth-library/adapter versions, local infrastructure image versions/licenses, and official source references. Include the lockfile and only necessary generated artifacts in the reviewable working tree; this does not authorize a commit.
- Establish real package scripts for formatting, lint, typecheck, focused tests, builds, OpenAPI generation/check, and dependency boundary checks. The source of truth is the actual manifests; do not predeclare guessed CLI commands in this baseline.
- Add minimal process bootstraps/health checks, validated environment loading, safe `.env.example` and ignored secrets/build outputs. Plan/configure one loopback HTTPS origin `https://localhost:8443` with web/API/Socket.IO and a restricted `/dw-staging/<opaque-key>` PUT route to private storage, preserving signed Host/path/query/headers. Record project-local TLS/browser trust setup; no second public S3 origin.
- Run isolated local compatibility checks for NestJS Express + Better Auth/Prisma: auth body parser vs ordinary JSON routes, persistent cookie session, basic login/logout/revocation, CSRF/origin behavior, Next.js private credential forwarding, and gateway session validation. Use throwaway local data, no product feature implementation. Record unsupported behaviors and required adaptations.
- Identify free storage, scanner, preview renderer and SMTP catcher candidates with hardware/license constraints. Specify path-style public upload signing separately from internal storage endpoints, origin/method restrictions and isolated project/organization/account media purposes. Phase 4 proves real upload/proxy/processing behavior under V03/V05; documenting topology is not proof.
- Establish test harnesses that can run against real PostgreSQL/Redis/storage when needed; no paid services, third-party account provisioning, remote CI writes, or public deployment.

Exit gate:

1. Web/API/worker boot locally; web displays only an honest minimal foundation screen, not fake product features. Required lint/typecheck/build and meaningful bootstrap checks pass with exact versions/commands logged.
2. Package dependency rules prevent web/contracts from importing server/database internals.
3. V01 has a concrete reproducible compatibility report. Any failing auth requirement blocks selecting that candidate for Phase 2; review the fallback/ADR before proceeding. Do not label the product authentication complete from a toy check.
4. Local service configuration is free, private by default, and free of committed secrets. Startup/shutdown instructions are reproducible; no persistent production data exists.
5. Evidence/traceability templates are in place and actual outcomes recorded. **Stop; request a separate Phase 2 authorization after review.**

### Exact recommended first implementation authorization

Authorize only the six deliverables: (1) pinned monorepo and package boundaries; (2) minimal three-process bootstraps; (3) local Compose/proxy/environment configuration; (4) actual validation scripts/harnesses; (5) isolated authentication/toolchain compatibility evidence; (6) updated decision/validation records and a Phase 1 exit report.

Exclude production identity/onboarding implementation, tenant/domain CRUD, production database migrations/data, real product pages, uploads/reviews, visual design libraries, deployments, commits, pushes, paid services, and global configuration changes. The current Phase 1 authorization permits throwaway local compatibility databases/services. Choose the smallest working foundation; do not expand the phase to “get ahead.”

## Phase 2 — Identity, tenancy, and security foundation

Approved Phase 1 infrastructure amendment: Windows-native PostgreSQL, a validated
Redis-compatible service with real BullMQ jobs, native authenticated SeaweedFS and
Mailpit SMTP replace mandatory Docker execution. Require native readiness,
loopback security, owned shutdown/restart/persistence and all existing regression
checks. Compose remains optional/not executed. See the
[revised acceptance and evidence report](PHASE_1_NATIVE_INFRASTRUCTURE_REPORT.md).
The amendment alone did not authorize Phase 2; the user's subsequent explicit authorization on 2026-10-16 satisfies that prerequisite.

Prerequisite: Phase 1 accepted; auth decision selected with V01 evidence; explicit Phase 2 authorization.

Scope: implement verified identity/session lifecycle, registration/login/logout/recovery, own profile text/password/sessions, onboarding/internal invitations, roles/ownership, organization name/description/timezone, selected principal, Access, migrations/RLS/runtime roles, audit/outbox/idempotency and durable local mail, including a narrow global identity-event lane for registration/recovery alongside tenant events. Client invitation targets extend with real Client/Project models in Phase 3. Logo/profile-image schema/endpoints/UI wait for Phase 4 Files; notification preference controls/effects wait for Phase 6 Communications.

Minimal UI: P01–P07 (P06 internal acceptance), P13, P29 text/description/settings, P31 account text/password/sessions. Add logo/profile-image controls only with Phase 4 and preferences only with Phase 6, so no inactive controls or fake URLs appear.

Exit gate:

- T01/T02 verify real cookie login, email proof, recovery, replay/race protection, logout/revocation, origin/CSRF, invitation binding, last-owner concurrency, and account self-scope.
- T03/T06 prove no-context failure, same-connection RLS, tenant A/B pool reuse, nested/raw query and FK isolation with actual nonowner runtime credentials (V02).
- Organization + first Owner + audit/outbox + onboarding receipt commit or roll back together. Initial outbox/mail retry tests establish T22/T23 infrastructure; later phases extend coverage.
- Tenancy/identity DTOs and OpenAPI are accurate; denial cases work through the minimal UI. Scope unfinished client invitations explicitly rather than presenting placeholder success.
- No tenant-domain CRUD phase starts until V02 passes. Stop for Phase 3 review.

## Phase 3 — Clients, projects, milestones, and tasks

Scope: client/contact records and real client invitation/grant acceptance; project/access/lifecycle; milestones and tasks with priority, one primary assignee, checklist structure/completion, internal task-specific threads/replies and append-only task history; priority/status/assignee/deadline filters, board/order, My Tasks/dashboard. Implement current assignment checks and history in this phase, before general project activity in Phase 7. Feedback-to-task source FK/command waits for Reviews in Phase 5. Emit relevant audit/outbox now.

Minimal UI: P08–P12, P16–P19, P23. Extend P06 with real client/grant acceptance and P13 with valid internal project-related context when applicable.

Exit gate:

- T04/T05 exercise organization → client → project → milestone → task plus priority/filter persistence, checklist permissions/completion independent of DONE, internal comment threads/replies, assignment/deadline/status history and denial cases through REST and minimal Next.js UI.
- T03/T06 verify tenant/project/task ancestry for every checklist/comment/history endpoint, source-independent task schema, current assignment and role checks, search/count/filter isolation, stale concurrent item/task edits, lifecycle/ownership races and revocation.
- Progress metrics follow the documented formulas, task changes persist, archived/completed lifecycle boundaries hold, and earlier identity flows pass their relevant regression checks.
- Every newly introduced mutation has required audit/outbox evidence. Stop for Phase 4 review.

## Phase 4 — Private files and immutable versions

Scope: implement the single-origin staging route/private S3 adapter, folder/file metadata, purpose-scoped uploads, scan/preview/retry/reconciliation, canonical bytes and authorized streams/ranges. Deliverables require a project but allow an optional same-project task; version preparation updates only the latest-prepared pointer. Add organization-logo and self-owned profile-image upload/asset/processing repositories with tenant outbox and an extension of the Phase 2 identity-event lane for self media on the same infrastructure. Attach ready images atomically; failed replacement preserves the old image. No review behavior is triggered by preparation.

Minimal UI: P21 folder/root browse, Manager folder controls and file uploads/moves; P22 optional task linkage and immutable version history; P18 deliverable links; P29 logo and P31 profile-image controls. All image/file processing states use real backend results.

Exit gate:

- V03/V05 and T07/T08 prove same-origin path-style signatures survive proxy routing, bucket/S3 endpoints remain private, hostile Origin/method/path/header tampering fails, conditional source/final writes work, byte/checksum/scan/preview limits hold, and project/logo/self-owned media cannot cross ownership boundaries. T21 verifies actual image attachment/replacement/removal.
- T06/T08 verify unlinked deliverables, valid link/unlink, cross-project link/folder denial, flat folder rename/move/empty deletion preserving byte identity and grants. Parallel/repeated commands cannot duplicate version numbers, overwrite prior bytes or delete attached history/active image assets.
- Working image/PDF previews identify the exact source; processing failures remain visible/recoverable and never return fake success. Test post-final-object/pre-DB crash recovery.
- No review/approval functionality starts until immutable file identity is proven. Stop for Phase 5 review.

## Phase 5 — Formal review, annotations, and client portal

Scope: exact-version shares/portal, selected-version cycles and any-one roster, explicit atomic active-review replacement, decisions/approvals, image/PDF annotations, visibility-filtered feedback/replies/resolution and portal. Work/Reviews integration adds Manager/O/A feedback-to-task conversion with immutable same-project source FK, permanent uniqueness, idempotency and internal-only links; support readable terminal feedback in active projects. Complete invitation return, dashboard/project review summaries and latest-prepared versus under-review labels.

Minimal UI: P25/P26, P32–P35; complete P22/P23 and P06 integrations. Approval needs deliberate displayed version confirmation. No elaborate visual design.

Exit gate:

- T09–T13 exercise internal/client upload → share → review → annotate → changes requested → prepare revision → explicitly open/review/approve, plus preparation/sharing during an open review. Image/PDF points persist across zoom/reload. T06/T12 verify conversion assignments/ancestry, atomic rollback, double-submit/different-key races, terminal source, and complete client task-link exclusion.
- T10/T11 distinguish preparation/decision (both valid on distinct exact-version facts) from replacement/decision (one winner), and cover replacement/replacement, duplicate replacement, target validation, grant/share/portal revoke and rollback. V04 requires audited old/new cycle/version references and no orphaned or double-open replacement.
- Clients cannot access internal/unshared/task-conversion data or decide as Reviewer/nonparticipant. Preparing/sharing N+1 leaves N's review intact; explicit replacement makes its old cycle terminal. Stale clients never approve N+1 implicitly, new versions inherit no approvals and history survives revocation.
- Exact-version file identity, audit, outbox, and idempotency effects are verified. Stop for Phase 6 review.

## Phase 6 — Notifications, real-time delivery, and worker reliability

Scope: complete notifications/read state and self-owned IN_APP assignment/review category preferences with real P31 controls; evaluate permission then preference at materialization, keep mandatory identity messages unaffected and do not retroactively erase/backfill notices. Add worker-to-API Redis hints, authorized sockets/revocation, REST catch-up, durable projections/receipts, failure visibility/replay and Redis-loss recovery using earlier events.

Minimal UI: P14, shared permitted notification indicators and P31 category preferences; recoverable delivery/processing state. Local operator replay/runbook remains sufficient; no extra admin page.

Exit gate:

- T14/T15/T21 test own-category defaults/save/effect, current permission despite preferences, disabled-category suppression, retained historical notifications, no backfill on re-enable, mandatory identity-message delivery, hostile/expired/revoked sockets and private reconnect behavior (V07).
- T22/T23 inject rollback, crash before/after enqueue, duplicate/out-of-order delivery, worker termination, scan timeout, and Redis restart/loss. Domain effects remain correct and recoverable (V06).
- Notifications/activity do not expose internal content to clients; exactly-once side-effect claims are absent; possible duplicate mail is documented and safe one-time proofs remain protected.
- Core scope is now 29 templates, subject to later integration/system gates. Stop for Phase 7 review.

## Phase 7 — Remaining full functional scope

Scope: **all seven expansion templates**, before redesign. Internal discussions, basic rich-text project documents/library (headings/bold/italic/safe links/ordered/unordered lists through a minimal visual editor and bounded structured schema), activity, reports, audit browser, and an aggregate client-update feed with optional permitted project filter. Managers publish via P16. Recording audit and task history already exists; extend P31 preference controls and notification consumers for discussion/document/client-update events as those sources become functional. No extra page/editor service/cloud drive.

Minimal UI: P15, P20, P24, P27, P28, P30, P36. Manager publishes client updates from a working inline control on P16. Reuse layouts/access/contract services; no new app per template.

Exit gate:

- T16–T20/T25 verify real persistence, every rich-text format round-trip and unsafe-paste/link rejection, document conflicts, reconciled reports, append-only audit, and authorized aggregate updates. T17 covers filtering/counts/cursors, withdrawn/revoked projects and no internal-activity/conversion leakage.
- Each of the seven templates has its full documented actions/states, resource permissions, and evidence; intended product scope totals 36.
- No expansion feature is silently deferred or replaced with a mock. Stop for Phase 8 review.

## Phase 8 — Complete minimal frontend integration

Scope: connect and verify all cross-module navigation and workflows using the existing thin Next.js frontend; resolve remaining real loading/empty/denied/validation/conflict/retry states, keyboard/focus/labels, client/internal layout separation, session/capacity switching, PDF/image interaction, responsive functional usability, and private caching behavior. This phase completes integration; it is not the first UI phase or the professional redesign.

Exit gate:

- All 36 pages have usable real actions and their acceptance criteria mapped to code, policies, and test evidence. No dead controls, stub routes, artificial sample counts, or runtime demo backends remain.
- T24/T25 traverse complete core and expansion workflows through Playwright using real services and authenticated internal/client contexts.
- Contract/client drift, accessible basic interaction, tenant/capacity cache separation, and error recovery are verified. Stop for Phase 9 review.

## Phase 9 — Full system verification and functional completion

Scope: execute the full acceptance matrix, targeted adversarial/concurrency/failure suites, appropriate regression checks, end-to-end scope review, operational recovery, backup/restore integrity, bounded performance/resource checks, and traceability audit. Close V01–V08 or record a reviewed scope/architecture change; no unproven critical invariant can be waived by calling it “design work.”

Exit gate:

- Every FR01–FR20 and P01–P36 record has implementation, exact policy, scenario/test reference, actual passing evidence, and reviewed status. All approved functional criteria are complete.
- No unresolved high-impact tenant isolation, client approval, canonical immutability, credential/session, or worker data-loss issue. Open lesser limitations require explicit review and must not contradict approved acceptance criteria.
- Fresh local setup, dependency pins, migrations, actual repository checks, data/file restore, and failure recovery work reproducibly without paid services. Testing documents distinguish automated proof, manual evidence, and remaining limits.
- User accepts functional completion and separately authorizes professional redesign. **A nearly complete core product is insufficient.**

## Phase 10 — Professional UI/UX redesign

Prerequisite: Phase 9 exit accepted and separate redesign authorization.

Scope: professional information hierarchy, design system, typography/color/layout, responsive polish, refined interaction/animation only as useful, and accessibility refinement across all 36 templates. Preserve contracts, domain rules, tenant/client boundaries, and completed functionality. Any desired new functional scope requires a separate review rather than being hidden in redesign.

Exit gate: previous functional/security/E2E evidence remains valid or is rerun where presentation changes affect behavior; all 36 templates use the reviewed design system and remain usable; no unauthorized deployment or external write occurs. Deployment is a separate authorization.

## Reconciled dependency checklist

| Restored/changed requirement | Existing pages / FRs | Required phase and proof |
| --- | --- | --- |
| Task priority, checklists, comments/history, filters/assignment | P10/P17/P18; FR06 | Phase 3 Work/policies/history; T04–T06 |
| Feedback-to-task conversion and permanent source link | P26/P18; FR06/FR10 | Phase 5 after Work + Reviews; T06/T12, no client backlink |
| Flat logical folders | P21; FR07 | Phase 4 Files; T06–T08; no nested ACL/storage hierarchy |
| Optional task / mandatory project on Deliverable | P22/P18; FR08 | Phase 4 same-project nullable FK; T06/T08 |
| Prepare/share independent of explicit replacement | P22/P25/P26/P34/P35; FR08/FR09 | Phase 5; T09–T11; approved history preserved |
| Organization description | P29; FR18 | Phase 2 text/settings and policy; T21 |
| Organization logo / own profile image | P29/P31; FR07/FR18 | Phase 4 safe Files pipeline plus tenant/self-owned scopes; T07/T08/T21 |
| Notification preferences | P31/P14; FR12/FR18 | Phase 6 assignment/review, Phase 7 new event categories; T14/T21 |
| Basic rich-text document authoring | P27/P28; FR15 | Phase 7 safe structured storage/editor; T18 |
| Aggregate client updates / optional project filter | P36, P16 publisher; FR11/FR14 | Phase 7 permission-before-aggregation; T13/T17/T25 |
| One-origin staging proxy topology | Infrastructure; FR07/FR19 | Phase 1 specification/config; V03 proof in Phase 4, T07/T08 |

No new page, FR, T, D or V identifier is required. Primary phase ownership below stays stable; P29/P31 and other incremental pages are not fully accepted until all listed dependencies work.

## Page delivery ledger

This assigns each page one primary delivery phase, avoiding double counting. Later integrations above still block full page acceptance. Phase 8/9 check every page.

| Phase | Primary page IDs | Count |
| --- | --- | ---: |
| 2 | P01, P02, P03, P04, P05, P06, P07, P13, P29, P31 | 10 |
| 3 | P08, P09, P10, P11, P12, P16, P17, P18, P19, P23 | 10 |
| 4 | P21, P22 | 2 |
| 5 | P25, P26, P32, P33, P34, P35 | 6 |
| 6 | P14 | 1 |
| 7 | P15, P20, P24, P27, P28, P30, P36 | 7 |
| **Total** | **P01–P36** | **36** |

## Phase handoff evidence

Every exit report includes phase scope and FR/page IDs; changed paths; exact runtime/dependency versions; real commands with result/exit code; focused test names; migration/constraint/RLS evidence where applicable; relevant screenshots/traces for interactions; unresolved validation IDs; and the exact next phase recommendation. Store long logs in the approved repository evidence location when implementation begins, with private data redacted.

### Feedback-to-task duplicate contract

For the same authorized actor/scope, the same idempotency key and matching payload replay the original result after authorization. A reused key with a different payload returns 409 Conflict. The same source thread with a different key returns 409 Conflict; include an existing-task reference only if that actor is still authorized to see that task. Client principals never receive internal task references. Permanent source uniqueness and transaction/concurrency protection remain mandatory. This is a Phase 5 contract, not Phase 1 application functionality.

## Historical Phase 1 review status (2026-10-16)

At the Phase 1 review, the authorized foundation implementation and isolated compatibility experiments were reviewable; see the [Phase 1 report](PHASE_1_REPORT.md). Local web/API/worker and PostgreSQL, builds and focused checks passed. The then-requested V01 gaps were closed with twenty real integration checks, including two-process proof races. Docker-backed service execution remained BLOCKED, keeping that dated Phase 1 review PARTIAL. This historical status is superseded by the current authority and Phase 9 evidence above; later phases are recorded in their reports.
