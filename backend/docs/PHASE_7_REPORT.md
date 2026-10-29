# Phase 7 implementation report

Date: 2026-10-18, Africa/Cairo. Workspace: `D:\Devworkspace`. Complete Phase 7 was explicitly authorized after acceptance of Phases 1–6 for their documented local scope. Stop before Phase 8; no commit, push or deployment is authorized.

## Exit status

**PASS — approved Phase 7 local-development scope implemented and verified; ready for user review.** All seven expansion workflows, their P16/P31 integrations, required preflight, integration/security checks and browser journeys passed. This does not accept the phase on the user’s behalf or certify full-system/production readiness. Stop at the Phase 7 review gate; Phase 8 is unstarted.

## Expansion actions and evidence

The working [coverage matrix](traceability/PHASE_7_COVERAGE.md) was created before implementation. All seven expansion templates are implemented, alongside their required P16/P31 integrations. One real browser journey traverses all seven; it uses ordinary UI login and real persistence, without route interception or mocked APIs.

| Page                | Implemented actions                                                                                                                                     | Policy                                                                            | Focused evidence                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| P15 reports         | Project/date filters, live task progress/overdue, exact-version approval count, terminal decision count/mean turnaround, empty state                    | Internal O/A tenant scope; Member current accessible projects                     | Phase 7 source reconciliation, UTC windows, zero denominator, excluded states and forbidden filters; browser project filter                           |
| P20 discussions     | Create/search/filter/page topics, read topic, append/page replies, Manager archive                                                                      | Manager/Contributor contribute; Viewer reads; no client access                    | Persistent/idempotent topic/replies, cursor pages, role/tenant/project denial, archive/reply race; browser create/reply/reload                        |
| P24 activity        | Ordered/filterable activity with cursor/counts, manual and eventual refresh                                                                             | Current internal project readers                                                  | Actual worker projection, source uniqueness, audit correlation, private-payload exclusion; browser action filter                                      |
| P27 library         | Search/filter/count/page accessible documents; choose writable project and create                                                                       | Internal authorized projects only                                                 | Forbidden destination/snippet/count isolation; browser creation/navigation                                                                            |
| P28 editor          | Headings 1–3, bold, italic, safe links, ordered/unordered lists, combined marks, safe paste, CAS save, conflict draft recovery, discard/reload, archive | Manager/Contributor author; Viewer reads; Manager archives                        | All formats persisted through API; browser toolbar round-trip, unsafe link/paste, two-window conflict, retained draft and Viewer read-only            |
| P30 audit           | Tenant action/actor/date filters, ordered cursor browsing; no edit/delete operation                                                                     | Owner/Admin only                                                                  | Metadata allowlist, Member/client denial, append-only SQL and audit fault rollback; browser filter and Viewer denial                                  |
| P36 updates         | Aggregate publications/shared review milestones; permitted project options/filter/counts/cursors                                                        | Selected active contact, live explicit grants/client/portal/share/asset authority | Two clients, same-client ungranted project, forged/revoked filters, withdrawal and exact-share revocation; browser published update/filter/withdrawal |
| P16 integration     | Manager publication and withdrawal with retained history                                                                                                | Current Manager/O/A on writable project                                           | Actual Manager and Contributor denial; browser inline publisher                                                                                       |
| P31/P14 integration | New default-enabled discussions/documents and client-update categories, scoped notices/read counts                                                      | Permission before self-owned prospective preference                               | Suppression/no backfill, client-safe delivery, live revocation, minimal socket hints; browser preference save/reload                                  |

## Backend and API inventory

`packages/server/src/expansion.ts` exports the domain service, reusing `Reviews.scoped`, `CoreDomain.project`, the restricted SQL unit of work and organization serialization. The product adapter only dispatches versioned routes. Strict `phase7.ts` schemas, OpenAPI operations and generated TypeScript contracts define explicit public DTO allowlists; ORM records are never returned.

All paths below are relative to `/api/v1/organizations/{organizationId}` and require a current session and `X-Organization-Principal`.

| Operations                          | Paths                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| reportsRead, auditList              | GET `/reports`, `/audit`                                                       |
| documentsList/Create                | GET/POST `/documents`                                                          |
| documentsRead/Save/Archive          | GET/PATCH `/projects/{projectId}/documents/{documentId}`; POST same `/archive` |
| discussionsList/Create/Read/Archive | GET/POST `/projects/{projectId}/discussions`; GET child; POST child `/archive` |
| discussionRepliesList/Create        | GET/POST discussion child `/replies`                                           |
| projectActivityList                 | GET `/projects/{projectId}/activity`                                           |
| clientUpdatesList/Create/Withdraw   | GET/POST `/projects/{projectId}/updates`; POST child `/withdraw`               |
| portalUpdatesList                   | GET `/portal/updates`                                                          |

Create/topic/reply/publication commands require scoped UUID idempotency keys. Matching retries reauthorize and replay; changed payloads conflict. Document saves and archive/withdraw commands use If-Match revisions. Pagination validates the cursor within the already authorized filtered set, uses creation-time/ID order (replies ascending), and refuses stale/foreign cursors rather than broadening scope. Filters/counts are evaluated before slicing. The implementation currently loads that scoped set before cursor slicing; bounded-memory/keyset SQL optimization and load certification are later system work, not a claim of large-dataset readiness.

## Database, RLS and authorization

All original 0001–0034 files remain unchanged. Additive, checksummed migrations:

| Migration | Inventory                                                                                                                                                                                                                                                 |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0035      | Discussion, append-only replies, bounded structured Document, ClientUpdate; forced RLS, composite organization/project/topic FKs, immutable ancestry/author, revision/lifecycle guards, query indexes; API cannot delete history                          |
| 0036      | Activity projection and unique source event/project identity; existing purpose-role capture/materialization/access functions extended for DISCUSSION/DOCUMENT/UPDATE; preference columns; safe activity-only history projection, no notification backfill |
| 0037      | Session-bound combined preference save preserving omitted Phase 7 categories for existing clients, same per-user lock/revision/audit                                                                                                                      |
| 0038      | Forward repair of reply-only field access in the shared trigger; no applied SQL rewritten                                                                                                                                                                 |
| 0039      | Content-free authorized withdrawal invalidation while optional notices remain publication-only; withdrawn publication notices fail current visibility                                                                                                     |
| 0040      | Additional file/access event project ancestry resolution                                                                                                                                                                                                  |
| 0041      | Actual display-name snapshot for future activity and upload/access source recovery; purpose-role name-only identity read, no email/credential or login-worker table grant                                                                                 |
| 0042      | Restore final Phase 6 ProjectMembership-to-Membership assignee binding in the extended materializer; existing assignment/socket regression detected an older predicate reused during extension                                                            |
| 0043      | Align SQL safe-link validation with case-insensitive HTTP(S) schemes accepted by the API; structured shape and credential/protocol rejection remain intact                                                                                                |

No runtime role gains ownership, DDL, BYPASSRLS, unrestricted identity access or migration credentials. Internal and client capacities remain separate; client affiliation grants nothing. APIs serialize all mutations with live authority revalidation and atomic audit/outbox/receipts. Archive never destroys content/history. SQL content validation supplements server validation, with fixed shape/depth and size limits; rendering uses explicit escaped React elements and safe links, never stored raw HTML.

## Communications and existing-domain integration

New source events use the existing tenant outbox, lease-bound restricted materializer, BullMQ worker, durable consumer receipt, recipient RLS and Socket.IO authorization port. No alternative queue, audit, notification or storage implementation was added. Internal discussion/document events never address client principals. Client updates notify only currently authorized contacts/internal readers with default-enabled preferences; disabling is prospective, retains prior notices and prevents replay backfill. Mandatory identity mail remains outside optional categories.

Activity is a separate content-minimized projection, unique per event/project and atomic with the existing materializer transaction. Historical resolvable events receive safe activity only; missing ancestry is not fabricated and old notification effects are not backfilled. Prior generic activity attribution remains as captured; later events store the initiating display-name snapshot. Audit holds actor/correlation authority. Shared review milestones reload exact-version sharing/availability; no internal task/conversion fields enter the client feed. Withdrawal invalidations contain only event/project IDs and still require live project access; reads remain authoritative.

Reports distinguish current task state from terminal events in `[from,to)` UTC. Progress is DONE/noncancelled with null for no tasks; overdue excludes DONE/CANCELLED; approvals count distinct exact version IDs; turnaround averages APPROVED/CHANGES_REQUESTED closed-minus-created seconds, excluding CANCELLED/SUPERSEDED. Date controls display the browser's local time and convert to UTC; organization timezone is retained, not treated as a different storage clock.

## Minimal frontend and browser evidence

`apps/web/app/expansion.tsx`, existing internal/portal catch-all routes, project navigation, P16 publisher and P31 preference controls use real APIs. UI remains semantic HTML/light CSS. The visual editor normalizes pasted content to text, serializes only supported structures, preserves failed-save drafts, and offers explicit conflict recovery. Current permission/lifecycle responses drive read-only states. Private reads have no shared cache; selected capacity remounts the private view. Existing notifications provide authorized hints; pages also offer manual refresh and periodic REST catch-up.

Private browser screenshots remain ignored in `.local/phase7/`. The passing browser candidate traversed all seven templates, toolbar save/reload, invalid link and paste, two-browser conflict, Viewer read-only/audit denial, publication/filter/withdrawal and preference persistence. The final rebuilt-browser result is recorded below; editor and client screenshots were visually inspected.

## Mandatory post-0034 preflight

[Preflight evidence](verification/phase7-preflight.txt): all 34 SQL hashes matched the applied database ledger, including final 0034; compiled outputs were newer than corresponding retained TypeScript source. Before implementation edits, `pnpm test:phase4` passed **24/24**, `pnpm test:phase5` passed **21/21**, and focused Phase 5/6 unit security checks passed **4/4**, all exit 0 with no skips/cancellations. Existing source-link/conversion/audit rollback/revocation cases ran in the actual Phase 5 suite. Boundaries and `git diff --check` passed. These are new runs against the final post-0034 database, not copied historical counts.

## Verification results

Final runtime and browser runs below passed with exit 0. `pnpm check` also passed runtime/boundaries/docs/infra/OpenAPI/environment/lint/typecheck, 13/13 units and formatting. The final aggregate repository check passed, including 13/13 unit tests; no skipped/cancelled integration scenario is counted as passing. [Sanitized command record](verification/phase7-final.txt); raw logs remain private under `.local/phase7/`.

| Actual command                                                                                              | Result        |
| ----------------------------------------------------------------------------------------------------------- | ------------- |
| `pnpm build`                                                                                                | PASS; exit 0  |
| `pnpm --filter @devworkspace/web build`                                                                     | PASS; exit 0  |
| `pnpm test:native`                                                                                          | 7/7; exit 0   |
| `pnpm test:integration`                                                                                     | 20/20; exit 0 |
| `pnpm test:phase2`                                                                                          | 20/20; exit 0 |
| `pnpm test:phase3`                                                                                          | 27/27; exit 0 |
| `pnpm test:phase4`                                                                                          | 24/24; exit 0 |
| `pnpm test:phase5`                                                                                          | 21/21; exit 0 |
| `pnpm test:phase6`                                                                                          | 19/19; exit 0 |
| `pnpm test:phase7`                                                                                          | 13/13; exit 0 |
| `node --test --test-timeout=300000 --test-name-pattern="all additive migrations" tests/phase4/api.test.mjs` | 1/1; exit 0   |
| `pnpm test:e2e:experiment`                                                                                  | 1/1; exit 0   |
| `pnpm test:e2e`                                                                                             | 1/1; exit 0   |
| `pnpm test:e2e:phase3`                                                                                      | 2/2; exit 0   |
| `pnpm test:e2e:phase4`                                                                                      | 3/3; exit 0   |
| `pnpm test:e2e:phase5`                                                                                      | 2/2; exit 0   |
| `pnpm test:e2e:phase6`                                                                                      | 1/1; exit 0   |
| `pnpm test:e2e:phase7`                                                                                      | 1/1; exit 0   |

Phase 4 includes all eight real scanner/AppContainer/renderer checks. Native lifecycle ran with apps stopped; V01 API/browser ran in separate experiment mode. The assignment repair 0042 was followed by full Phase 2–7 reruns. Document-only 0043 was then covered by Phase 7 persistence/security, fresh-schema installation through 0043, full production build and all product browser suites. The final P33 project-filter link received an additional web build and a fresh Phase 7 backend/browser run. Unchanged earlier suites are not represented as testing unrelated new document rules.

The initial full Phase 6 regression was 8/19 passed with 11 failures, including dependent fixture failures; after 0042 the original suite passed 19/19. The final Phase 3 browser run initially passed 1/2 before a login P2028/extended timeout; the unchanged complete rerun passed 2/2 in 16.3 seconds. Inspection found no persistent PostgreSQL blocker, and retry sampling saw one zero-second worker transaction wait. No definitive cause is claimed; this remains a local timing observation for system hardening, not an authorization waiver.

## Issues and corrections

The first real domain run reproduced PostgreSQL 42703: a shared trigger referenced reply-only `NEW.discussion_id` for nonreply rows. A restricted-role transactional probe isolated it; 0038 uses shape-safe JSON field extraction. Assertions were retained and the suite passed afterward. A new unapplied SQL file initially had a malformed dollar-quote delimiter due to JavaScript replacement syntax; its failed transaction rolled back, the unapplied file was corrected and preparation passed. An analogous return-path edit was caught by TypeScript before a successful build. Documentation checks also caught a line-ending-sensitive authority edit that removed older README/architecture text; retained baseline sections and later D19–D21 decisions were restored, with the new Phase 7 authority retained, and all links/36-page checks passed again.

The full Phase 6 regression exposed an assignment-recipient regression introduced while extending an older materializer body: a Membership ID was compared directly to the ProjectMembership assignee snapshot. Existing assignment/socket tests failed; dependent fixture tests then failed because the first test had not saved its task reference. Forward 0042 restores the exact final Phase 6 binding, with new categories/activity retained and no assertion changes. Full Phase 6 and affected regressions are rerun after the repair.

One unchanged Phase 3 browser attempt reported a login P2028/extended timeout; no persistent database blocker was found after failure. The complete unchanged rerun passed 2/2, with only one zero-second worker lock wait sampled. No definitive root cause is claimed; preserve this local timing observation for Phase 9.

The browser detected list structure lost through browser-generated wrapper elements; the serializer now traverses those wrappers and the same list round-trip assertions pass. A selector initially matched multiple valid formatted elements; it now targets the intended text. One browser run started before full stack readiness and failed login; it was rerun after readiness. Type/lint checks caught optional-field typing and an unused type. Review found discard/reload could reinitialize cached content; the corrected operation fetches the latest revision explicitly and keeps the editor mounted across failed background reads. A new portal-toggle fixture omitted the existing required `client_id`; correcting the fixture retained strict production schemas. The additional safe-uppercase-link document correctly added a second audit record; the new test now asserts the exact two document IDs and one record per creation, rather than the old one-document fixture count. A restricted-runtime probe also reproduced API/SQL disagreement on a safe uppercase HTTP(S) scheme; 0043 aligns the SQL scheme check, and a persistent round-trip covers it. Dropped editor content is normalized to text alongside paste, with browser assertions for the inserted safe text.

## Preservation, limits and remaining 36-page work

A 286-file SHA-256 baseline and all original migration hashes were captured before edits under ignored `.local/phase7/`. No reset/clean/staging operation, historical migration rewrite, canonical object deletion, credential change, dependency upgrade, Docker/WSL installation, Windows/global setting change, commit, push or deployment was performed. Only ownership-checked app/service lifecycle commands and synthetic test rows/fault hooks are used. Native tool/storage/AppContainer identities remain retained. The final [preservation inventory](verification/phase7-files.json) records zero missing baseline files, all 34 prior SQL files unchanged, all 43 applied migration hashes matching source, and an unchanged lockfile. Final restricted-role inspection confirms all five expansion tables force RLS, runtime/purpose roles lack superuser/BYPASSRLS, and the purpose role is NOLOGIN without schema CREATE.

All 36 templates retain their approved primary phase ownership: P01–P07/P13/P29/P31 (Phase 2 with later media/preferences), P08–P12/P16–P19/P23 (Phase 3 with later review/update integrations), P21/P22 (Phase 4), P25/P26/P32–P35 (Phase 5), P14 (Phase 6), and these seven expansions (Phase 7). Earlier accepted reports are historical evidence, not an assertion that every action on every template was reverified by opening a route. Final regression suites and the feature ledger distinguish actual workflow checks from full-system acceptance.

Phase 8 remains cross-module navigation/error/recovery/usability integration across all 36 pages. Phase 9 retains system-wide certification, complete V08 database/object restore, canonical orphan reconciliation/retention, load/resource checks and full traceability acceptance. Phase 10 professional design is separately authorized only after functional acceptance. Existing AppContainer/CVD freshness, sampled disk budget, private canonical orphan, hard-crash work-residue/operator recovery, development-only Memurai and organization serialization limits are unchanged. No final certification, production readiness or exactly-once SMTP claim is made.

## Recommended next scope

Review this completed Phase 7 result before any next-phase authorization. Once this gate is accepted, the recommended separate Phase 8 scope is the documented full minimal frontend integration and cross-module acceptance review across all 36 templates. Do not begin Phase 8 automatically.
