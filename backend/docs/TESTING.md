# Testing, acceptance, and traceability

## Phase 9 final verification entry points

The Phase 9 runbook and actual verdict are in [PHASE_9_REPORT.md](PHASE_9_REPORT.md); the T01–T25, V01–V08 and P01–P36 evidence map is [PHASE_9_EVIDENCE.md](traceability/PHASE_9_EVIDENCE.md). Run `pnpm check`, `pnpm build`, `pnpm test:native` (with the app stopped), `pnpm test:phase2` through `pnpm test:phase8` serially, the experiment checks `pnpm test:integration` and `pnpm test:e2e:experiment`, then all product browser suites including `pnpm test:e2e:phase9`. `pnpm phase9:workload` creates retained synthetic data and private ignored fixtures; it is bounded to 100 tasks, 100 milestones, 1,000 documents, 10 projects and concurrency 4. `pnpm phase9:db-recovery` verifies live API readiness/session recovery across a graceful owned native-service outage; run it only when interrupting this checkout's native services is acceptable. `pnpm phase9:snapshot` and `pnpm phase9:restore <snapshot-name>` use isolated, ownership-checked copies; read [infra/README.md](../infra/README.md#phase-9-backup-and-restore) before repeating them. The snapshot is not an atomic cross-store transaction. Never delete canonical objects or reset the retained cluster to resolve a reconciliation finding.

Current Phase 9 results and limitations are reported separately from historical phase runs. The final evidence table distinguishes tests executed during this gate from prior accepted implementation evidence and from scenarios that remain unverified.

## Phase 8 integration verification (historical procedure)

[36-page action inventory](traceability/PHASE_8_ACTIONS.md) maps approved actions, components, policy, states, entry/return paths and evidence. `pnpm test:phase8` verifies real review-filter counts and denial. `pnpm test:e2e:phase8` verifies cross-module links, multiple organizations, recoverable filter history/reload, portal separation, multiple client contacts in one organization, paged milestones and live grant/session revocation. It uses actual APIs/PostgreSQL/native services; no security-critical workflow is mocked. Run the existing Phase 2–7 suites serially first; Phase 5 creates retained synthetic review fixtures. New safe-return/filter units run under `pnpm test`. [Phase 8 report](PHASE_8_REPORT.md) records actual outcomes; no route/control is a passing test by itself.

## Phase 7 verification entry points

The required post-0034 gate is in [phase7-preflight.txt](verification/phase7-preflight.txt): Phase 4 24/24, Phase 5 21/21, focused security units 4/4; all exit 0 before implementation edits.

Run `pnpm test:phase7` on the real product/native stack, then `pnpm test:e2e:phase7`. The suite creates synthetic retained rows and ignored `.local/phase7/browser.json`; the browser logs in normally and performs actual toolbar/discussion/report/audit/publisher/client-filter/preference writes. T16–T20/T25 include strict input, role/capacity/ancestry isolation, cursor/counts, CAS/lifecycle, audit rollback, exact share visibility, preferences, lease denial and live sockets. No API interception/scanner bypass; full V08 restore remains Phase 9.

Earlier suites stay serial because SMTP/native/Redis tests interrupt owned services. Stop apps for native lifecycle tests; use separate experiment mode for Phase 1. [Phase 7 report](PHASE_7_REPORT.md) records actual counts/exit codes; source review is not runtime evidence.

## Phase 4 verification, 2026-10-17

See [PHASE_4_REPORT.md](PHASE_4_REPORT.md) for executed counts/exit codes and [FEATURE_MATRIX.md](traceability/FEATURE_MATRIX.md) for action traceability. `tests/phase4/api.test.mjs` exercises real S3/proxy signing, quarantined processing, canonical version identity, roles/ownership, ancestry, concurrent preparation, media attachment, grace cleanup and SQL integrity. `tests/phase4/sandbox.test.mjs` runs actual AppContainer token/network/filesystem/credential/resource/scanner/renderer checks. `tests/e2e/phase4.spec.ts` uses real UI uploads, persisted listing/version history, folder pagination and profile/organization images. No security-critical integration path is mocked.

Run `pnpm test:phase4` with the native services and product stack running and verified processing tools prepared. Run previous Phase 2/3 integration suites serially: their deliberate SMTP/outbox failure fixtures can interfere with concurrent account setup. Run `pnpm test:native` only with the app stopped because it restarts the owned services. Run `pnpm test:e2e:phase4` for the new browser slice, then retained browser regressions as documented. V03 covers actual local storage behavior; Phase 4 V05 covers scanner/render isolation and budgets, while Phase 5 annotation geometry remains later. Only the approved staging-cleanup subset of V08 is exercised here; full retention/restore remains later.

Historical Phase 3 evidence, 2026-10-16: [PHASE_3_REPORT.md](PHASE_3_REPORT.md) separates Phase 3 runs from then-historical Phase 2 results. [FEATURE_MATRIX.md](traceability/FEATURE_MATRIX.md) includes Phase 3 action/policy/migration/test mappings.

Historical Phase 1 status, 2026-10-16: foundation/compatibility verification was authorized at that time. Its isolated bootstrap/auth experiments did not satisfy the later T01–T25 product scenarios. Actual Phase 1 commands, outcomes and limitations are recorded in [PHASE_1_REPORT.md](PHASE_1_REPORT.md).

## Test categories and timing

| Category | What it proves | When required |
| --- | --- | --- |
| Unit | Policy decisions, transition predicates, metric definitions, annotation coordinate transforms, retry classification | With nontrivial rule introduction; do not mirror implementation line by line |
| Database integration | Real PostgreSQL constraints/RLS, transaction context, immutable rows, locks, rollback, unique keys, migrations | With each schema/invariant change; never substitute SQLite or mocked Prisma |
| API/contract | Real NestJS endpoints, session/CSRF, DTO validation, error semantics, OpenAPI/client drift, idempotency | With every functional slice |
| Authorization/security | Tenant/project/client/field/visibility boundaries across all access paths | With every resource and policy; negative tests are phase gates |
| File/worker integration | Real local S3/Redis jobs, scanner/render limits, bytes/checksums, retry/receipt/reconciliation | Phases 4–6 and when changed |
| Concurrency | Controlled parallel commands and invariant outcomes under real DB locks/connections | Ownership, completion, version, decision, revocation and outbox races |
| Playwright E2E | Actual Next.js browser interaction and persisted outcomes through real backend/services | Incremental thin UI per phase; full T24/T25 in Phases 8/9 |
| Operational/manual | Fresh setup, restore, failure visibility, limited resource usage, keyboard/annotation usability | Relevant phases and final system gate |
| Documentation/static | Page/FR/scenario references, links, phase coverage, whitespace, scoped changes | Every planning/contract change |

Use the actual pinned repository scripts once they exist. Unit success alone cannot establish tenant safety, storage immutability, worker recovery, or complete functionality. Choose focused regression checks based on changed behavior; broaden when failures/new changes warrant it. Redesign reruns the flows it changes and all affected authorization/contract interactions.

## Fixtures and execution environment

- Use isolated real PostgreSQL, Redis, private storage, mail catcher, scanner, and renderer versions from the approved local stack. Separate migration credentials from runtime credentials. RLS tests must use nonowner/nonsuperuser/NOBYPASSRLS connections; admin credentials create fixtures only.
- Prepare organizations A and B; Owners/Admins; Members with Manager/Contributor/Viewer assignments and an unassigned Member; two clients within A; contacts with Viewer/Reviewer/Approver grants, a contact with no grant, a revoked contact, and a user with multiple distinct capacities. Distinct browser contexts keep cookies/capacities separate.
- Create projects A1/A2/B1, unrelated clients, same-looking resource names, priority/filter/checklist/comment/history fixtures, root/flat folders, unlinked/task-linked deliverables, exact image/PDF fixtures and prepared/shared/review-target version combinations. Add source feedback/conversion collisions, rich-text format/unsafe-paste cases, published/withdrawn aggregate updates, logo/self-owned image fixtures and default/disabled notification preferences as their phases arrive.
- Synthetic deterministic fixtures belong in tests only. No production placeholder API/data. E2E may seed its isolated test database through a controlled fixture path; it must use real HTTP/session/storage flows for the behavior being asserted.
- Capture safe request IDs, state/revision snapshots, actual SHA-256, durable receipts, bounded socket events, and selected DB rows as assertions. Redact secrets, proof links, cookies, signed URLs, private content, and real personal data in evidence.
- Concurrency tests use barriers/latches or controlled hooks to align operations on distinct real connections. Assert possible valid winner orderings and final invariants; do not rely only on arbitrary sleeps or require one fixed winner. Tests cannot pass because two commands accidentally ran sequentially.
- Run RLS rollback/pool reuse tests with enough pool pressure to reuse connections. Run relevant migrations against a clean database and an earlier populated schema, verifying that custom SQL protections remain. Test failure recovery without destructive operations against the developer's actual data.

## Concrete acceptance scenarios

Scenario IDs below are planned coverage, not passed tests. Each scenario expands into named automated cases plus manual evidence only when automation is impractical.

### T01 — Identity, session, CSRF, and recovery

Register and verify email, log in, read own account, change password with recent proof, revoke another session, and log out through actual cookies. Assert Secure/HttpOnly/SameSite/host/path behavior under HTTPS, fixation resistance, credential forwarding, no shared caching, and protected-route denial after logout/expiry/reset. Submit hostile/missing Origin and invalid CSRF on both business and library auth routes. Exercise throttling and uniform recovery responses. Two concurrent uses of a reset/verification proof produce one successful consume and no reusable proof; inspect DB session invalidation, not merely UI redirect.

### T02 — Onboarding, invitations, and ownership

Create Organization + first Owner + audit/outbox atomically; inject failure and assert no partial tenant. Repeat onboarding with same key and changed payload. Invite/accept internal and later client targets with verified intended email; test wrong identity, stale inviter privilege, expired/revoked/replayed token, role/target tampering, and concurrent acceptance. Concurrent ownership demotions/transfers cannot leave zero Owners; Admin cannot remove/promote Owners. Accepting an invitation grants exactly its reviewed same-tenant targets.

### T03 — Tenant isolation across every data path

Use A's session/capacity against B's CRUD/nested IDs/cursors/search/count/report endpoints, folder/file/range/preview, checklist/comment/history, review/feedback/conversion/decision, notifications/documents and sockets/jobs. Repeat valid child IDs under wrong parents and overposted tenant/source/owner fields. Expect no identifying payload or writes. Test nonowner DB access with absent/wrong context, pool reuse/rollback/raw/nested queries and cross-parent FKs. Separately test A's own-account image/preferences against another global user and same-tenant private project boundaries; neither a global identity exception nor tenant RLS substitutes for those policies.

### T04 — Internal and client resource permissions

Exercise every action-matrix row for O/A, Manager, Contributor, Viewer and client roles. Task priority/assignment/checklist structure and feedback conversion require management authority; only the currently assigned Contributor toggles checklist/work state, while Contributors may post internal threads on accessible tasks. Viewer/client/inactive assignments are rejected; downgrade/removal atomically clears or reassigns active tasks with history, and blocks subsequent work/checklist writes. Test client denial even for their own feedback's converted task, forged conversion/source fields, folder administration versus upload selection, optional task linkage, logo owner and self-profile/preference boundaries. Preserve prior invitation/ownership/capacity rules; neither another client's affiliation nor combined capacities grants project access.

### T05 — Real delivery workflow and metrics

Through real API/UI, create client/project/milestone/tasks with each priority, assignment, checklist and deadlines; filter the board by priority/status/assignee/due window and My Tasks by its own-assignee scope plus priority/status/project/due window. Check/uncheck items, add threaded comments/replies, change assignment/status/deadline and reload task history with correct actors/order. Validate priority enums, checklist row revisions, completion timestamps and no implicit task-DONE/checklist coupling. Revoked/unassigned Contributors cannot toggle others' work. Preserve empty/overdue/cancelled task progress, archive/read-only and explicit project/milestone completion; all changes have required durable history/events.

### T06 — Relational integrity and concurrent work updates

Test nullable Deliverable.task_id with mandatory Project: unlinked creation succeeds; same-project link/unlink preserves versions; cross-project/tenant links or forged project changes fail. Exercise Task→Milestone/assignee/source FeedbackThread, checklist/comment/history→Task, ProjectFile→Folder/Asset, Cycle→Version/replaced Cycle and participant/decision/approval/feedback ancestry through API and permitted runtime SQL. Inject conversion failure to prove no task/source/history/receipt remains. Race checklist/task saves, assignment revoke, folder delete/move, repeated feedback conversion, task/milestone/project completion and last-owner changes on real connections. Invariants and safe conflicts must survive; archive must not orphan source/version links.

### T07 — Hostile and interrupted upload processing

Against the actual proposed HTTPS proxy/private S3 stack, upload valid project PNG/JPEG/PDF and logo/profile PNG/JPEG. Verify path-style URLs signed for the external Host/port survive unchanged path/query/signed headers to S3; internal-URL rewriting, method/Host/path/checksum/condition tampering fails. Staging GET/HEAD/DELETE/list/admin routes, foreign/missing Origin, unsigned/replayed/expired PUTs and host-published S3 access must be denied. Confirm cookie-free upload bypasses NestJS and only authorized intent/finalization uses the API; same-origin flow requires no wildcard CORS.

Test fake MIME/extension, malformed/active PDF, page/pixel/byte excess, image-purpose PDFs, unsafe image metadata, scanner failure/timeout and isolated harmless scanner signature. Observe quarantine and unavailable downloads. Kill processing before/after canonical creation; retry/reconcile without replacing bytes. Verify project/logo/global-profile owner and purpose cannot be swapped; finalization rechecks authority after capability issuance. Stubs cannot provide release evidence for actual proxy/storage/scan guarantees.

### T08 — File access and immutable version bytes

Compare canonical SHA-256 before/after creating N/N+1; deny runtime/version metadata mutation and object overwrites. Test root/flat folders, duplicate names, uploads into existing folders, metadata-only file moves/rename, empty-only folder removal including archived references and cross-project denial; bytes, version links and permissions remain identical. Validate optional task attachment without changing project lineage.

Probe asset IDs, thumbnails/PDF ranges, security blocking, revoked share/grant, private caches and unsafe filenames/headers. For logos/profile images, test clean attachment/replacement/removal, own/tenant policy and pending/rejected replacement preserving the prior image. Orphan cleanup cannot remove referenced versions/active images or race attachment. Prior history remains intact.

### T09 — Version-bound decisions and eligibility

Open a cycle on an explicitly selected clean/shared version N with named active Approvers. Prepare and separately share N+1: N remains OPEN and eligible; approving displayed N creates exactly one matching Decision/Approval with digest/actor/audit/outbox and never approves N+1. Wrong cycle/version/digest, unshared target, Reviewer, unlisted Approver, internal Owner and revoked contact are denied; being older than the latest-prepared pointer is not itself a denial.

Explicit replacement to a newer ready/shared same-deliverable version yields old SUPERSEDED/new OPEN with fixed distinct targets and linked audit evidence. Invalid target/roster, including an already approved target version, leaves the original intact. Terminal cycles never reopen; with none open, a new cycle can explicitly select an eligible never-approved shared version, retaining prior terminal history. Already approved versions cannot be re-reviewed. Request changes needs a reason; no operation silently retargets a stale client window.

### T10 — Competing decisions and idempotent replay

Synchronize approve/request-changes decisions on one cycle: exactly one terminal decision and Approval iff approved. Same actor/key/payload replays only after current authorization, with no duplicate facts/events; different payload gives conflict and another actor's key is isolated. Replay after revocation discloses no stored private response.

Repeat a successful explicit replacement with the same key and after response loss: return the same authorized new cycle. Competing replacement commands/keys cannot open two cycles or supersede a terminal source. Permanent decision/replacement/conversion uniqueness survives idempotency TTL expiry.

### T11 — Decision versus preparation, replacement and revocation

Race preparation of N+1 and decision on open N: both may commit, N's decision remains exact and N+1 unapproved. Repeat with sharing N+1; neither operation supersedes N. Then race explicit replacement of N with decision: replacement first makes old decision conflict; decision first makes replacement conflict with no new cycle. The Manager must reload and explicitly open the next cycle after a decision wins. A separate later prepared version does not change the replacement's selected target.

Inject failure between superseding old and opening new, and around audit/outbox/receipt writes; transaction rollback restores old OPEN and leaves no replacement. Race two replacements and validate one-open-cycle/linked-source uniqueness. Separately race grant/share/portal revoke, archive and session revocation against authorization, proving live ordering and preserved historical facts. In-flight authorized responses may finish; never infer recall of already delivered data.

### T12 — Real image/PDF annotations and feedback visibility

Place/save/reload an image pin and PDF page-2 point across zoom/scroll/rotation; validate normalized geometry/source/digest, page/bounds/NaN and wrong-cycle version. Internal/client-visible feedback, replies and resolution respect visibility across REST, notifications and sockets; closed cycles reject new feedback and resolution never approves.

From an open or readable terminal feedback thread in an active project, Manager/O/A creates a task with priority, valid optional milestone/assignee and immutable same-project source reference. Test rollback, duplicate clicks, simultaneous different-key conversions, same-key changed payload, forged project/source, inactive project, invalid assignee and Contributor/Viewer/client denial. One task/link/history/event result survives. Assert original result replay for authorized same-key/matching payload; 409 for changed-payload same-key or different-key same-source, including existing-task reference only when currently visible; deny such references to clients. The source task link survives archive; source task link survives archive. Client payloads have no task IDs, backlink, conversion marker, task comments/checklists/history or notification leakage. Conversion leaves feedback/approval state unchanged.

### T13 — Portal and capacity isolation

Invite a contact, sign in, inspect only granted portal projects/curated overview, authorized organization branding, shared history and exact review files. Probe unshared versions, same-client ungranted projects, internal tasks/conversion metadata/discussions/documents/team/reports/audit. Use P36 aggregate/project filter and malformed/forbidden IDs without leaking private project options/counts. Switch organization/capacity/back navigation and ensure previous private data cannot reappear. Own profile/preference operations never expose another user; version wording distinguishes active review from newest shared bytes.

### T14 — Notification recipient and resource isolation

Generate assignment/review/discussion-document/client-update events and assert default enabled optional categories and one logical notification per permitted recipient/event. Save own preferences, disable a category, then emit new events: no new optional notice for that category; other enabled categories still deliver. Existing notifications remain; re-enable produces no retrospective backfill. Password recovery/verification/invitation/security mail is unaffected. Record materialization/setting commit ordering for in-flight events.

Unauthorized users cannot read/edit another's preferences or notifications. Permission filtering precedes preference lookup/materialization and remains on reads; revoked grants/shares suppress bodies/links regardless of setting. Retry/out-of-order events do not duplicate/regress state, leak converted task details or roll back committed business decisions.

### T15 — Socket authentication, subscriptions, and revocation

Connect with valid/expired/forged sessions, hostile Origin, and wrong capacity. Attempt arbitrary/internal/other-tenant room joins and malformed messages. Only authorized server-derived subscriptions succeed. Revoke membership/grant/session while connected and trigger later events; no newly authorized private emission succeeds, reconnect is rejected, and invalidations already in flight disclose no private content. REST after revocation always denies. Simulate unavailable session/policy storage and expect fail-closed behavior. Drop a worker-to-API Redis hint or restart the gateway: durable notifications remain and REST reconnect/refresh catches up without treating socket delivery as durable completion.

### T16 — Internal discussions

Manager/Contributor create a topic/replies, reload/filter/paginate, and Manager archives it. Viewer reads but cannot post; clients/nonmembers/other tenants cannot read content, snippets, reply IDs or events. Archived project/topic rejects writes. Validate/sanitize text and preserve author history after membership deactivation.

### T17 — Activity and client updates

Project activity has stable order/cursors and one logical entry per source event, excluding sensitive audit content. Manager publishes/withdraws client updates from P16. P36 aggregates only permitted published updates and shared review milestones across multiple accessible portal-enabled projects in the selected client capacity/organization, optionally filtering one. Project navigation opens the same template with a query filter.

Authorize before union/pagination/counts; dropdowns/counts/cursors reveal no inaccessible project. Test two clients in one tenant, another tenant, withdrawn events, grant/share/portal revocation, same-client ungranted projects and a stale/forged filter; forbidden filters cannot fall back to all projects. Internal activity/task conversion details never appear in feed, notifications or subscriptions.

### T18 — Documents and save conflicts

Using the minimal visual editor, create/save/reload headings, bold, italic, HTTP(S) links, ordered and unordered lists, including combined marks. Assert stored allowlisted schema and rendered formatting. Paste unsupported HTML/styles/embeds/scripts; normalize or reject them, unsafe protocols/URLs and excessive depth/length server-side. Escaped text and safe link attributes prevent injection even with crafted API payloads.

Library search/counts require project access. Two browser saves on one revision yield one success and a recoverable conflict retaining unsaved text. Viewer reads only; client/nonmember/archived writes fail. No hidden public preview or collaborative-editing engine is required; plain textarea-only authoring is insufficient.

### T19 — Reports and calculation reconciliation

Seed deterministic mixed-status tasks/versions/reviews with UTC boundaries and organization timezone. Reconcile done/noncancelled ratios, overdue rules, version approval counts, and terminal-only turnaround against scoped source records; zero denominator is “no tasks.” Compare Member scoped totals versus Admin totals. Filters, pagination, and date windows cannot expose inaccessible projects or count excluded cycle states. Clearly assert live-state metrics vs time-window event metrics.

### T20 — Audit integrity, safe evidence, and recovery

Assert audit records for every required sensitive action with correct tenant/actor/capacity/target/correlation and minimal metadata. Runtime UPDATE/DELETE fails; clients/Members cannot browse. Inject audit write failure and assert the sensitive domain mutation rolls back. Denied-attempt logging is separate, bounded, and redacted. Search representative logs/traces/OpenAPI/generated output for secret leakage. Restore an isolated DB plus file snapshot and verify referenced exact-version SHA-256 and audit relationships.

### T21 — Settings and account self-scope

Owner/Admin save organization name/plain-text description/timezone; Member/client overposting fails and Owner-only transfer needs recent proof. Test clean organization logo upload/attachment/replacement/removal, pending/failed image preserving old pointer, other-organization/project/profile asset substitution, client branding read only with an accessible portal project and safe description rendering. Own profile image is initially self-only, including for a client user without internal membership; foreign user IDs or image assets fail and active references survive cleanup.

Verify display name/password/session self-scope and stale conflicts as before. Exercise Phase 6 real category preference controls/effects and mandatory-message exceptions with T14. No unapproved email-change/billing routes. No file-dependent control claims completion before Phase 4.

### T22 — Transactional outbox and effect atomicity

Inject failure before/after domain, audit, outbox, and receipt writes. Rollback leaves none of the uncommitted facts; committed facts eventually yield corresponding effects. Dispatch only committed rows; payload schema/tenant/type are verified. Crash after enqueue before ack, replay duplicate events, reorder aggregate revisions, and assert unique logical effects/receipts. Cross-tenant dispatch interface cannot read domain content or mint arbitrary authority.

### T23 — Worker failure, Redis loss, and reconciliation

Terminate a worker mid-scan/render/projection/mail; simulate storage/SMTP/Redis outages, lost accepted Redis jobs, expired leases, exhausted attempt budgets, and restart. PostgreSQL pending-consumer state reconstructs incomplete work; successes are not repeated as new versions/decisions/notifications. Failures are visible and safely replayable by the local operator path. Mail may duplicate after ambiguous delivery but never creates new reusable proof/rights. Cleanup claims cannot remove bound assets. Assert durable state and completed effects, not merely queue job counts.

### T24 — Core end-to-end and functional UI

Playwright uses real web/API/worker/services with separate Owner/Contributor/client contexts: register/verify/onboard → invite → client/project/milestone/task → priority/filter/checklist/comments/history → flat-folder upload → optional-task/unlinked deliverable → share/open review → annotate → convert feedback to internal task → prepare/share N+1 while N remains open → explicitly replace → client confirms exact new target → approve → inspect historical version/notifications. Also exercise request-changes/new-cycle path and own logo/profile image/preferences when their phases arrive.

Assert actual persisted state/bytes, client blindness to internal conversion, every required format/action and 29 core templates. Include empty/error/denied/conflict/retry/expiry/capacity-switch, keyboard labels/focus and narrow viewport checks. A route rendering is insufficient.

### T25 — Expansion and full-scope regression

Exercise all seven expansion templates with actual persistence: discussion/reply, activity, rich-text library/editor format round-trips and conflicts, scoped report, Admin audit, aggregate client updates with permitted project filtering. Repeat exact-version decision/replacement and task-detail flows afterward and after redesign. Every restored requirement maps to its existing FR/page/scenario evidence; all 36 templates and FR01–FR20 must be verified before redesign.

## Traceability method

The IDs in this baseline are the feature inventory. For every approved feature/page action, maintain a record with `FR ID`, `page IDs/action`, `scope status`, `owning module/use case`, `source path`, `REST operationId/schema version`, `policy/action + allowed/denied principals`, `DB invariant/migration`, `scenario + actual test name/path`, `evidence command/run/date/exit code`, `result`, and `limitation/decision ID`.

At implementation time, store the ledger under a reviewed path such as `docs/traceability/FEATURE_MATRIX.md` and run records under `docs/verification/`; those extra files are not created by this planning task. Link focused screenshots/traces for annotation/recovery interactions and safe machine outputs where useful. Every P01–P36 page also gets an acceptance checklist for all its actions/states, including negative permissions. One FR may have multiple page/action records. No acceptance is inferred from another feature merely sharing a component.

Use statuses **planned → in progress → implemented/unverified → verified → accepted**. “Verified” requires actual evidence; “accepted” requires phase review. A failed/unrun/skipped test is recorded as such. Architectural changes update the decision register and every affected mapping. The plan's page delivery ledger supplies primary phase ownership; later integrations remain required.

### Initial feature-to-implementation and permission ledger

All implementation/policy paths below refer to planned modules in `packages/server`; actual source/operation/test paths are **pending**. This is a usable starting mapping, not a claim of implemented code. Scenario IDs resolve above; permission meanings resolve to [SECURITY.md](SECURITY.md#action-matrix).

| FR | Page IDs | Planned module / permission | Delivery phases | Scenarios | Implementation/evidence |
| --- | --- | --- | --- | --- | --- |
| FR01 | P02, P03, P04, P05, P06, P07, P13, P31 | Identity/Organizations; public proof-bound flows or own account; invitation issuer policy | 2, 3, 5 | T01, T02 | Pending / not run |
| FR02 | P06, P07, P13, P29 | Organizations/Access; O/A, Owner-only transfer | 2 | T02, T03 | Pending / not run |
| FR03 | P11, P12 | Clients; O/A writes, scoped internal reads | 3 | T03, T04 | Pending / not run |
| FR04 | P08, P09, P12, P16, P23 | Projects/Access; O/A creation, assigned Manager administration, internal scoped read | 3, 5 | T03, T04, T05 | Pending / not run |
| FR05 | P18, P19, P16, P33 | Work/Portal; Manager mutation, curated client milestone summary only | 3, 5 | T05, T06 | Pending / not run |
| FR06 | P08, P10, P16, P17, P18, P26 | Work; Manager administration/conversion, assigned Contributor checklist/work, internal comments/history | 3, 5 | T04, T05, T06, T12 | Pending / not run |
| FR07 | P21, P22, P26, P29, P31, P34, P35 | Files; flat project folders, scoped project/logo/self-profile uploads and reads | 4, 5 | T06, T07, T08, T21 | Pending / not run |
| FR08 | P18, P22, P34 | Deliverables; mandatory project, optional same-project task, prepare/share independent of review | 4, 5 | T06, T08, T09 | Pending / not run |
| FR09 | P16, P22, P25, P26, P35 | Reviews; Manager explicit replacement, fixed target, named current Approver decision | 5 | T09, T10, T11 | Pending / not run |
| FR10 | P18, P26, P35 | Reviews/Work; visibility/geometry, Manager feedback conversion, no client task backlink | 5 | T06, T12 | Pending / not run |
| FR11 | P06, P12, P23, P32, P33, P34, P35, P36 | Access/Portal; explicit same-client project grants/share/portal | 3, 5, 7 | T03, T04, T13 | Pending / not run |
| FR12 | P14, P31; shared layout indicators | Communications/Identity; own optional category preferences and recipient policy | 6, 7 | T14, T15, T21 | Pending / not run |
| FR13 | P20 | Collaboration; internal Manager/Contributor writes, Viewer reads | 7 | T16 | Pending / not run |
| FR14 | P24, P36; P16 publisher | History/Communications; internal activity, permission-filtered aggregate client updates | 7 | T13, T17 | Pending / not run |
| FR15 | P27, P28 | Collaboration; basic visual rich-text authoring, safe structured content, internal policy | 7 | T18 | Pending / not run |
| FR16 | P15 | Reporting; authorized internal project set only | 7 | T19 | Pending / not run |
| FR17 | P30; sensitive actions throughout | History; append-only system writes, O/A browse | 2–7 | T20 | Pending / not run |
| FR18 | P29, P31 | Identity/Organizations/Files/Communications; self image/preferences, O/A description/logo | 2, 4, 6, 7 | T01, T02, T07, T14, T21 | Pending / not run |
| FR19 | All protected templates | Access/database/events; tenant + resource + state + system-purpose constraints | 2–9 | T03, T06, T10, T11, T22, T23 | Pending / not run |
| FR20 | P01–P36 | Web/contracts; server-backed allowed actions and denied/error states | 2–9 | T24, T25 | Pending / not run |

## Phase/system verification report format

Record scope and review status; exact dependency/service versions; fixture/reset method; actual command and working directory; start/date and exit code; test names/counts/results including skipped cases; relevant safe artifacts; invariant/permission assertions; FR/page IDs; unresolved V IDs; and known limits. Separate source review, unit proof, real integration proof, and manual observation.

Phase 9 cannot mark full functional completion until the ledger contains all 36 templates and their actions, the 20 FR groups, all required negative/race/failure scenarios, and accepted resolution of validation risks. Skipping expansion templates or replacing the scanner/storage with release-test mocks fails the gate. No successful test result is inferred from a planning document.

## Planning-task verification record

- Initial inspection: `D:\Devworkspace` was empty; `git rev-parse` / `git status` reported no Git repository. Existing work was not overwritten.
- Documentation consistency checks, 2026-10-15: inline read-only PowerShell assertions exited 0. Confirmed exactly eight UTF-8 Markdown files; 36 unique page definitions (29 core/seven expansion); area counts 7/8/9/4/3/5; required route/action/permission/state/dependency/acceptance fields on every page; each page assigned exactly once in the primary phase ledger; 20 feature definitions mapped to 20 traceability rows; 25 defined scenarios; 12 provisional decisions and eight validation items; all referenced IDs resolve.
- The final read-only assertion run checked 31 local Markdown links/anchors, balanced fenced blocks, final newlines, no trailing whitespace/tabs, and no invalid UTF-8/replacement characters. No packages were installed. These are documentation checks, not proof that diagrams compile or architecture integrations work.
- `git diff --check`: not applicable in the inspected non-Git directory; do not initialize Git merely to claim this check ran.
- All application/security/infrastructure/E2E results: **not run; implementation is absent**.

## Reconciliation verification record

The reconciliation changes documentation only. Existing P01–P36, FR01–FR20, T01–T25, D01–D12 and V01–V08 identifiers are preserved. The earlier planning record above describes its original run; this revision is checked separately. Runtime compatibility, RLS, proxy/S3 behavior, scans, rich-text rendering, concurrency and worker recovery remain untested.

Executed from `D:\Devworkspace` on 2026-10-15:

| Actual command/check | Outcome |
| --- | --- |
| `git rev-parse --is-inside-work-tree` (exit code explicitly propagated) | Exit 128: no Git repository; `git diff --check` is not applicable and was not run |
| `rg -n -i` legacy-contract search across `README.md AGENTS.md docs` | Exit 1, zero matches for removed automatic-supersession, mandatory-task, old document-format and former project-only update-route patterns |
| Inline read-only PowerShell assertions using `ReadAllBytes`, strict UTF-8, `[regex]::Matches`, `Compare-Object` and `Test-Path` | Exit 0: all 36 definitions/required page fields; 29 core/seven exact expansion; area counts 7/8/9/4/3/5; unchanged FR/T/D/V sets; explicit page-feature mappings; complete primary phase ledger and dependency checklist |
| Same inline assertions: links/anchors, fields, restored-feature presence and removed-rule searches | Exit 0: 31 local links/anchors resolve, balanced fences, final newlines, no trailing whitespace/tabs/encoding replacement; restored coverage and concrete origin/P36 route present |
| `Get-ChildItem -Recurse -File -Force` and `Get-FileHash -Algorithm SHA256`, compared with the pre-edit in-memory snapshot | Eight Markdown files only; seven modified: README plus PRODUCT_SPEC, ARCHITECTURE, DATA_MODEL, SECURITY, IMPLEMENTATION_PLAN, TESTING; AGENTS unchanged |

The assertions and targeted searches support a manual consistency review; they do not prove runtime security, rendered diagram compilation or compatibility. No dependency/service/application test was run. The revised baseline is ready for review and a Phase 1 authorization decision; restored scope and recommended product defaults still require that review. No phase was started.


### Feedback-to-task duplicate contract

For the same authorized actor/scope, the same idempotency key and matching payload replay the original result after authorization. A reused key with a different payload returns 409 Conflict. The same source thread with a different key returns 409 Conflict; include an existing-task reference only if that actor is still authorized to see that task. Client principals never receive internal task references. Permanent source uniqueness and transaction/concurrency protection remain mandatory. This is a Phase 5 contract, not Phase 1 application functionality.

## Phase 1 execution evidence

See the [execution report](PHASE_1_REPORT.md) for commands, exit codes, corrections and the V01 matrix. Actual focused results: three unit tests, twenty real HTTPS/PostgreSQL/Socket.IO integration tests and one real Chromium E2E test pass; lint/typecheck/build and configuration/boundary/format checks pass. The original eight integration cases remain. Twelve new cases cover idle/absolute/recent-auth, rotation, verified-only login, real verification and expired/reused/concurrently consumed proofs. Four email and four recovery race trials each send four simultaneous requests across two independent Nest API processes against the same real PostgreSQL database; exactly one request wins per proof.

Fixtures age disposable database rows using database time, avoiding long sleeps or public test clock overrides. They preserve the normal request path and do not mock auth/network/database behavior. Actual Africa/Cairo database timezone exposed an initial policy bug (13 PASS/7 FAIL); explicit UTC comparisons corrected it. Original idle acceptance and verification replay gaps were reproduced before fixes. Synthetic proof URLs stay in the ignored correlated inbox and are not printed. The second loopback API process is owned and stopped by the test.

The earlier Docker execution gate is superseded by the approved Windows-native
gate in the [native validation report](PHASE_1_NATIVE_INFRASTRUCTURE_REPORT.md).
`pnpm test:native` exercises real PostgreSQL, authenticated Redis/Lua and pinned
BullMQ jobs, private S3 and SMTP capture, plus actual owned shutdown/restart and
retained data. Run it with the application stopped because it restarts PostgreSQL.
Mocks do not qualify. Build/check, all twenty V01 integration checks and browser
E2E remain required. Docker-specific runtime tests are optional/not executed,
never inferred from native passes. Production abuse controls/RLS/domain workflows,
V03/V05/V06 product guarantees and T01–T25 acceptance remain future gates.
Foundation checks do not complete any product template or authorize Phase 2.

## Phase 3 verification entry points

Run `pnpm test:phase3` against the actual product/native stack for Clients/Projects/Work/Access API, persistence, permissions, ancestry, filters/metrics, CAS, held-lock concurrency, invitation targets, runtime SQL/RLS, audit rollback and clean migrations. Run `pnpm test:e2e:phase3` for actual owner and distinct Contributor/Viewer/client browser flows. Existing `pnpm test:phase2`, `pnpm test:e2e`, `pnpm test:integration`, `pnpm test:e2e:experiment`, `pnpm test:native`, `pnpm build` and `pnpm check` remain regression commands. Stop the owned application before the native lifecycle suite and switch explicitly to experiment mode for V01. No reset is required.

[PHASE_3_REPORT.md](PHASE_3_REPORT.md) records exact current results, initial failures/corrections and remaining limitations. Historical counts in prior reports are not substituted for new runs. Phase 3 browser fixtures use real registration/verification and API setup for additional roles; browser interactions use normal login/cookies/CSRF and persistent endpoints. No mock authentication or fake product data is introduced.

## Phase 5 verification entry points

`tests/phase5/security.test.mjs` covers Manager/Contributor/Viewer controls, terminal-source task eligibility, frozen SQL roster/annotation/source guards and blocked-share revocation. `zz-lifecycle.test.mjs` verifies cancellation on portal/share/project/deliverable withdrawal, no implicit reopening, completion blocked by an OPEN review, wrong target digest, event-failure rollback and lock-observed grant/share/project archive/session revocation races against decisions. The browser journey prepares/uploads/shares a new version while the old cycle is OPEN, explicitly replaces it, rejects the stale client's decision, retains old feedback, and approves only the selected new cycle. Phase 6 notification/socket portions of T11/T12/T24 remain deferred.

`pnpm test:phase5` exercises actual native processing/storage and restricted runtime PostgreSQL through HTTPS. `pnpm test:e2e:phase5` uses only the ignored retained synthetic records generated by that suite; run the integration suite first. It logs in normally through the UI with separate internal/reviewer/approver/viewer contexts, not fixture auth or mocked APIs. Browser mutations deliberately consume those synthetic cycles, so rerun test:phase5 before repeating the browser journey. `.local/phase5-*-annotation.png` and `.local/phase5-portal.png` retain private browser evidence. Unit `phase5.test.mjs` checks inverse transforms across quarter-turns/scales/offsets, geometry validation and safe portal returns. Exact counts/results and unrun requirements are in [Phase 5 report](PHASE_5_REPORT.md).

## Phase 6 verification entry points

`pnpm test:phase6` runs notification/recipient/preference/RLS, independent API/socket, and recovery suites serially against actual PostgreSQL, BullMQ/Memurai, SMTP, private storage and the existing processor. It creates only retained synthetic fixtures. Its ignored `.local/phase6-browser-fixture.json` supplies `pnpm test:e2e:phase6`; run the backend suite first. Browser flows use normal login, real preference/read writes, worker-backed notifications and REST recovery, with private screenshots ignored locally.

V06 includes concurrent/out-of-order receipt uniqueness, effect/receipt fault rollback, delayed preference ordering, a separately spawned actual worker killed while blocked in projection, natural lease recovery, removal of one accepted synthetic job, actual saved Redis shutdown/restart, actual owned SMTP outage/retry, exhausted visibility and restricted audited replay. No global queue flush or canonical deletion. V07 uses separate actual API/socket processes for hostile/forged/expired/cross-capacity handshakes, current subscriptions, grant/session revocation, worker Redis fanout, unavailable policy denial and restart/REST catch-up. The upload-status held-row regression proves a finalizer lock cannot block the authorized GET.

Run existing integration/browser suites serially because they deliberately interrupt shared local services. Stop owned app processes before native restart or experiment-mode checks. Phase 7 discussion/document/client-update categories and expanded activity feeds remain deferred. Exact executed commands/results are in [Phase 6 report](PHASE_6_REPORT.md); no prior report count is a new test result.
