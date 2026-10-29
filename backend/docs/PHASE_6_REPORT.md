# Phase 6 implementation report

Date: 2026-10-18. Authorization: Phases 1–5 accepted for their verified local-development scope; complete Phase 6 authorized, stop before Phase 7.

## Exit status

**PASS — approved Phase 6 local-development scope implemented and verified.** Persistent authorized notifications, IN_APP assignment/review preferences, independent-process realtime and durable recovery passed the tests below. Stop at the Phase 6 review gate. Phase 7 and final system certification require separate authorization; inherited operational limitations remain.

## Feature and API inventory

P14 internal notifications and the same component within the client portal; shared scoped unread indicators; P31 self-owned IN_APP assignment/review preferences; recipient-scoped read/unread state, category/state filtering, permission-filtered counts and stable time/ID pagination. No marketing, push, SMS or optional email channel. Discussion/document/client-update categories and P36 remain Phase 7.

Eight added operations under `/api/v1`:

| Operation                   | Method/path                                                | Policy                                                                        |
| --------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| notificationPreferencesRead | GET `/me/notification-preferences`                         | Actual account/session only; default enabled                                  |
| notificationPreferencesSave | PATCH same                                                 | Strict booleans, If-Match, durable self revision and identity audit           |
| notificationsList           | GET `/organizations/{organizationId}/notifications`        | Selected current internal recipient; live resource policy before counts/pages |
| notificationRead            | POST same `/{notificationId}/read`                         | Own currently authorized record; repeat is harmless                           |
| notificationsReadAll        | POST same `/read-all`                                      | Own currently authorized records only                                         |
| portalNotificationsList     | GET `/organizations/{organizationId}/portal/notifications` | Selected active contact capacity, current grants/portal/shares                |
| portalNotificationRead      | POST same `/{notificationId}/read`                         | Same client recipient boundary                                                |
| portalNotificationsReadAll  | POST same `/read-all`                                      | No cross-capacity merge                                                       |

REST DTOs and generated OpenAPI/client are authoritative. Browser controls call real APIs. No stored private names, content, filenames, signed URLs, task conversion details or reusable authorization links enter notification envelopes. Generic summaries link to an authorized task, exact review or shared version history.

## Categories, recipients and preferences

| Source                                                                      | Effect                                                                                                                             |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Task create/update, task comments and checklist events with an assignee     | assignments notice for the snapshotted project assignee, only if still assigned and currently authorized at materialization        |
| Review open/replace/cancel/decision, feedback/replies/resolution/conversion | reviews notice for current internal project readers; clients only for explicitly client-safe action types and shared exact targets |
| Version preparation/sharing                                                 | reviews notice for current internal readers; clients only for explicit sharing with live grant/portal/share/available asset        |
| Project/milestone lifecycle                                                 | Authorized project invalidation; no invented optional category                                                                     |
| Identity/security/team invitations, membership/access changes               | Existing mandatory mail and live socket/REST authority checks; no preference-based suppression                                     |
| Unmapped/historical event                                                   | Durable handled receipt, no retroactive notification creation                                                                      |

Permission is checked before the narrow preference read. Defaults are enabled; disabling acts at materialization, including on previously committed but delayed events. Setting/materialization serialize on the same per-user advisory lock, after authorization. Existing records remain; a skipped event gets a receipt and cannot be backfilled by re-enabling/replaying. Mandatory verification/recovery/invitation/security mail remains outside optional settings. Preferences grant no resource authority.

## Persistence and isolation

Additive 0028–0034 preserve every applied earlier migration and event. New tenant events capture a schema version, typed scoped resource/revision, action and assignment snapshot without rewriting historical envelopes. Notification has forced tenant/recipient RLS, event/project ancestry, permanent event/recipient/capacity/category uniqueness and immutable history apart from first read timestamp. Its insert guard binds target/action/time to the actual immutable outbox envelope. API has no notification INSERT/DELETE authority; only scoped SELECT and read timestamp UPDATE.

The global preference table is a separate identity boundary, not a nullable-tenant table. No API/worker table grant exposes arbitrary preferences. Session-bound self read/save functions validate the account and revision; updates append identity audit. `dw2_communications` is a new NOLOGIN, NOINHERIT, nonowner/non-superuser/non-BYPASSRLS purpose role behind fixed-search-path, restricted EXECUTE functions. The dispatcher still cannot read domain tables. The worker only invokes a validated live-lease materialization port; it gains no direct domain/preference/notification SQL authority.

0029 corrects project-membership versus organization-membership recipient identity. 0030 qualifies a project parameter colliding with PostgreSQL's relation-row identifier. 0031 adds bounded backoff jitter and content-free delivery status. 0032 strengthens typed event capture and envelope ancestry. 0033 links new events to their transaction's audit, actor and request, with a tenant/audit composite foreign key. 0034 carries minimal transaction-local audit identifiers across the existing restricted file-worker path, whose tenant RLS context remains unchanged. Actual API task and worker file-processed events verify that correlation. All repairs are new forward migrations; no applied SQL was edited. Recovery preserves the database, migration ledger and storage, then uses reviewed forward repair and the existing restricted replay interface.

## Realtime

Product Socket.IO uses websocket transport, exact Origin, actual cookie session and a strict selected organization/principal/capacity context. Room names are server-generated. Subscribe validates each project, caps subscriptions and rejects arbitrary room/authority fields. A one-second bounded revalidation loop removes stale connections without waiting for another business event. It does not refresh idle timestamps. Every emission rechecks session, selected principal and current recipient/resource policy in a tenant transaction; old room membership confers nothing.

Workers publish only event/organization references after materialization commits. Gateways reload trusted outbox/notification rows and emit minimal `notifications.changed {event_id}` or `state.changed {project_id,event_id}` invalidations. Internal task and feedback conversion events cannot reach client capacities. Independent API gateways subscribe separately to the private Redis hint channel; no distributed room trust or adapter is needed for this local shape.

Redis hints are expendable. Reconnect/navigation/manual refresh and a 30-second bounded REST refresh recover missed messages from PostgreSQL. A permission store failure denies reads/emissions; unknown or foreign event hints do not authorize a resource. In-flight packets/downloaded copies cannot be recalled. REST and domain state remain authoritative.

## Worker reliability and operations

The existing tenant/identity outbox and BullMQ worker remain the only event delivery pipeline. A tenant consumer materializes under the existing organization lock, commits notifications plus one durable consumer receipt atomically, then completes outbox delivery. Completion rejects new tenant envelopes without that receipt. Concurrent/reordered/duplicate materialization cannot create duplicate notifications or regress domain state. Receipt decisions outlive Redis jobs and optional socket hints.

PostgreSQL claim leases expire after 30 seconds and reconstruct incomplete jobs after queue loss. Attempts count claims, not successful external sends. Failed consumption uses capped exponential backoff with bounded jitter; eight claims exhaust the event and keep it visible. Invalid/stale leases cannot materialize/complete an event. SMTP can succeed before a receipt commits and therefore can duplicate; exactly-once external delivery is not claimed. Hint publishing failure does not undo committed effects.

`pnpm events:status` exposes at most 100 content-free event/attempt/state/lease/error/projection entries using restricted worker credentials. Existing aggregate mail status remains available. `pnpm events:retry identity|tenant <event-uuid>` reuses the audited exhausted-event replay function; no new operator admin page, arbitrary SQL tool or unrestricted replay authority. Replays retain consumer receipts and permanent uniqueness. Preserve ignored credentials and all canonical objects. Phase 4 processing crash residue still requires its documented operator inspection/recovery.

## Verification and failures

Raw private logs remain ignored under `.local/phase6-*.txt`. Sanitized final evidence is in `docs/verification/phase6-final.txt`; preservation hashes are in `docs/verification/phase6-files.json`.

| Executed command                                                                                            | Actual result                                                                                           |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `pnpm build`                                                                                                | PASS, database generation and all workspace builds                                                      |
| `pnpm test:native`                                                                                          | PASS, 7/7                                                                                               |
| `pnpm test:integration`                                                                                     | PASS, 20/20, separate experiment mode                                                                   |
| `pnpm test:e2e:experiment`                                                                                  | PASS, 1/1                                                                                               |
| `pnpm test:phase2`                                                                                          | PASS, 20/20                                                                                             |
| `pnpm test:phase3`                                                                                          | PASS, 27/27                                                                                             |
| `pnpm test:phase4`                                                                                          | PASS, 24/24                                                                                             |
| `pnpm test:phase4:sandbox`                                                                                  | PASS, 8/8 after official signature refresh                                                              |
| `pnpm --filter @devworkspace/web build`                                                                     | PASS, final UI copy build                                                                               |
| `pnpm check`                                                                                                | PASS, runtime/boundaries/docs/infra/OpenAPI/environment/lint/typecheck, 13/13 unit tests and formatting |
| `pnpm test:phase5`                                                                                          | PASS, 21/21                                                                                             |
| `pnpm test:e2e`                                                                                             | PASS, 1/1                                                                                               |
| `pnpm test:e2e:phase3`                                                                                      | PASS, 2/2                                                                                               |
| `pnpm test:e2e:phase4`                                                                                      | PASS, 3/3                                                                                               |
| `pnpm test:e2e:phase5`                                                                                      | PASS, 2/2                                                                                               |
| `node --test --test-timeout=300000 --test-name-pattern='all additive migrations' tests/phase4/api.test.mjs` | PASS, 1/1, fresh schema through 0034                                                                    |

`pnpm test:phase6`: **PASS, 19/19**, no skipped or cancelled tests. `pnpm test:e2e:phase6`: **PASS, 1/1**, rebuilt final UI. `git diff --check`: **PASS**; only existing CRLF normalization warnings. All 34 applied migration hashes match their files. Documentation checks retain all 36 templates, 29 core and seven expansion.

Phase 6's integration suite exercises actual task/review/version events, live recipient visibility, preferences and audit correlation; independent API/session/grant revocation; direct restricted-role SQL denials; concurrent materialization; projection rollback; independent worker termination and natural lease recovery; lost accepted work plus real Redis restart; exhausted replay; and real SMTP outage/retry. Its browser journey exercises internal list/filter/read/bulk-read controls, saved preferences, suppression/no backfill, disconnect clearing and reconnect catch-up, then client-portal isolation. Screenshots remain ignored locally and were visually inspected. The deliberate Redis interruption prints an expected transport reset while persisted recovery assertions pass.

The full earlier-phase regression run preceded the final 0034 worker audit-context repair. Fresh-schema installation, all 19 Phase 6 tests (including actual worker audit correlation), final browser flow and root checks were rerun afterward. Final source review covered contracts/routes, recipient policy/RLS, preferences, worker receipts/completion, per-emission checks, minimal UI integration, migration ownership/grants and baseline preservation; no unresolved Phase 6 blocking finding remains.

Focused tests already reproduced and corrected two SQL issues through forward migrations: the assignment snapshot identifies ProjectMembership, not Membership, and an unqualified `project` argument collided with a relation identifier. Initial role creation/function replacement also respected the existing non-CREATEROLE migration owner: the approved role bootstrap creates/validates the purpose role, and owner-specific DDL runs under its owning role, without broadening login-role permissions.

A real upload-status GET/finalizer deadlock was observed in PostgreSQL. Status reads now use a scoped committed read after unchanged organization/session/project authorization, while mutations retain row locks. A held upload-row regression verifies the read does not wait on finalization. The unavailable-policy test was corrected to withdraw actual purpose-role policy-table access and inject a late valid hint; revoking a caller function grant did not simulate the intended policy-store failure.

A final rerun exposed a test synchronization race: it asserted the second socket hint immediately after receiving the first, while the gateway was still checking the second hint's authorization. The test now waits within the existing bounded deadline for both independently checked payloads, and still asserts their exact minimal fields. Production authorization was unchanged. Initial queue integration also corrected an unsupported BullMQ Queue client assumption by using the already pinned independent Redis publisher. Worker audit correlation was repaired through 0034 after source review found the restricted file-worker path could not read the prior audit under its unchanged RLS context.

After the paused task resumed, local services were stopped and PostgreSQL recovered the retained directory normally. A rerun before restoration failed to connect; a subsequent run passed 12/19 but failed the shared upload setup with `SCANNER_UNAVAILABLE`. The retained daily signatures had crossed the existing two-day age limit. Processing was stopped, official signatures refreshed with the retained FreshClam binary, and the existing preparation/isolation checks rerun. No scanner-age bypass or permission relaxation was introduced. FreshClam's incremental update produces a CLD; the preparation script intentionally expects CVD files, so a full daily CVD was downloaded into an ignored dedicated directory and supplied through the existing preparation path. No source dependency pin changed.

## Preservation and limits

Before edits, 204 existing source files were SHA-256 inventoried in ignored `.local/phase6-baseline.json`. No baseline commit is assumed; staged and untracked work remains. Existing databases, migration history, canonical objects, AppContainer/profile/ACL controls and specifically approved staging cleanup remain intact. ioredis 5.8.2 and socket.io-client 4.8.4 are reused at their existing pins through API/web dependency wiring; no package version upgrade or new binary/service was introduced. Dependency installation used the offline cache with zero downloads.

Failure tests affect only owned processes, synthetic rows/jobs and scoped fault hooks. Redis restarts save and retain other service data; only an explicitly created synthetic queue job is removed to reproduce accepted-job loss. No global flush, database reset, broad purge, canonical deletion, Windows/global/firewall/service change, external delivery, commit, push or deployment occurs.

Inherited Phase 4/5 storage, orphan/canonical reconciliation, processing crash residue, local hardware and full backup/restore limitations remain. Organization serialization and per-recipient checks prioritize correctness over throughput; no load certification is claimed. Phase 7 expansion templates, professional redesign and final system certification remain deferred.

## Recommended next action

Review and accept Phase 6 for this documented local-development scope. The exact next scope is separately authorized Phase 7 expansion functionality for P15/P20/P24/P27/P28/P30/P36, with its own acceptance checks. Do not begin it automatically; professional redesign waits until all 36 templates are functionally complete and verified.
