# Phase 8 — Complete functional frontend integration

Date: 2026-10-19, Africa/Cairo. Workspace: D:\Devworkspace. Phases 1–7 were accepted for their documented local-development scope; the user's attached request explicitly authorized complete Phase 8. No Phase 9 or professional redesign is authorized.

## 1. Exit status

**PASS — approved Phase 8 local-development functional integration is complete and verified; ready for user review.** All 36 templates have implemented actions mapped to real API/policy and browser evidence. No outstanding mandatory Phase 8 functional integration gap remains. This does not accept the phase on the user’s behalf or certify production, restore/load limits or professional design. Stop at the Phase 8 review gate.

## 2. All 36 templates and action completion

The [detailed action inventory](traceability/PHASE_8_ACTIONS.md) compares every approved page with actual routes, roles/capacities, actions, controls/API families, loading/empty/validation/conflict/failure states, entry/return paths and existing/new tests. It supplements the [feature matrix](traceability/FEATURE_MATRIX.md); route rendering alone is never evidence. Browser suite numbers below mean tests/e2e/phaseN.spec.ts; matching real API/security suites supply denial, concurrency, integrity and failure evidence. The new journeys test representative cross-module transitions; they do not imply every possible role/state combination was repeated in the browser.

| Page | Action-completion scope                                                                 | Browser evidence suites |
| ---- | --------------------------------------------------------------------------------------- | ----------------------- |
| P01  | COMPLETE — runtime-covered: Accurate public introduction/auth entry                     | 2                       |
| P02  | COMPLETE — runtime-covered: Login/logout, recovery and selected principal               | 2, 8                    |
| P03  | COMPLETE — runtime-covered: Registration, SMTP verification/resend                      | 2                       |
| P04  | COMPLETE — runtime-covered: Uniform recovery request                                    | 2                       |
| P05  | COMPLETE — runtime-covered: Proof-bound password reset                                  | 2                       |
| P06  | COMPLETE — runtime-covered: Internal/client invite review/accept/return                 | 2, 3, 5                 |
| P07  | COMPLETE — runtime-covered: Atomic organization onboarding                              | 2                       |
| P08  | COMPLETE — runtime-covered: Scoped dashboard/work/review links                          | 3, 5, 8                 |
| P09  | COMPLETE — runtime-covered: Create/filter/edit/project lifecycle                        | 3, 8                    |
| P10  | COMPLETE — runtime-covered: Own-task filters and detail continuation                    | 3, 8                    |
| P11  | COMPLETE — runtime-covered: Client list/create/status filtering                         | 3, 8                    |
| P12  | COMPLETE — runtime-covered: Contact edit/status/invite/client lifecycle                 | 3, 8                    |
| P13  | COMPLETE — runtime-covered: Invitations, member role/status administration              | 2, 3, 8                 |
| P14  | COMPLETE — runtime-covered: Recipient filters/read/bulk-read/realtime                   | 6, 7, 8                 |
| P15  | COMPLETE — runtime-covered: Scoped metrics/date/project filters                         | 7, 8                    |
| P16  | COMPLETE — runtime-covered: Project progress/lifecycle/publish/withdraw                 | 3, 5, 7, 8              |
| P17  | COMPLETE — runtime-covered: Task metadata/assignment/order/filters                      | 3, 8                    |
| P18  | COMPLETE — runtime-covered: Work/checklist/comments/history/source links                | 3, 5, 8                 |
| P19  | COMPLETE — runtime-covered: Milestone create/edit/order/completion/progress             | 3, 8                    |
| P20  | COMPLETE — runtime-covered: Discussion/search/reply/archive                             | 7, 8                    |
| P21  | COMPLETE — runtime-covered: Private folder/file/upload/retry/download                   | 4, 8                    |
| P22  | COMPLETE — runtime-covered: Task link/unlink, versions/history/archive/review entry     | 4, 5, 8                 |
| P23  | COMPLETE — runtime-covered: Internal participants and client grants/revocation          | 3, 5, 8                 |
| P24  | COMPLETE — runtime-covered: Authorized activity filters/cursors                         | 7, 8                    |
| P25  | COMPLETE — runtime-covered: Status/deadline/exact-version review filters                | 5, 8                    |
| P26  | COMPLETE — runtime-covered: Exact preview/annotations/replies/decisions/conversion      | 5, 8                    |
| P27  | COMPLETE — runtime-covered: Document library/search/create/destination                  | 7, 8                    |
| P28  | COMPLETE — runtime-covered: Visual formats/save/reload/conflict/archive                 | 7, 8                    |
| P29  | COMPLETE — runtime-covered: Settings/logo/ownership policy                              | 2, 4, 8                 |
| P30  | COMPLETE — runtime-covered: O/A read-only audit filters/cursors                         | 7, 8                    |
| P31  | COMPLETE — runtime-covered: Self profile/image/password/sessions/preferences/capacities | 2, 4, 6, 7, 8           |
| P32  | COMPLETE — runtime-covered: Explicitly granted portal projects/capacity                 | 5, 8                    |
| P33  | COMPLETE — runtime-covered: Curated overview and counted milestone pages                | 5, 8                    |
| P34  | COMPLETE — runtime-covered: Shared exact-version history/download/badges                | 5, 8                    |
| P35  | COMPLETE — runtime-covered: Client feedback and named exact-version approval            | 5, 8                    |
| P36  | COMPLETE — runtime-covered: Authorized publication/review aggregate and filters         | 7, 8                    |

No approved template or action was replaced with a placeholder, runtime demo record or mocked backend. Detailed controls and the appropriate test layer are recorded in the inventory rather than silently treating every route as complete.

## 3. Missing integrations discovered and corrected

- P01 still said files/reviews were under development and advertised an implementation-only experiment. Public copy now describes implemented workflows; the isolated experiment remains directly available in its separate mode.
- Workspace/project navigation differed across files, reviews, discussions, documents and settings. Shared links now connect the modules and provide coherent returns. Members have no team/audit administration navigation; direct paths retain backend denial. Portal project navigation exposes only overview/reviews/updates/shared material. Nested main landmarks were removed.
- Account embedded a portal anchor in a capacity-inspection button and did not bind entry to that contact. Links and buttons are separate semantic controls; account entry and portal selectors retain the selected contact per organization/capacity and resolve it against current self-principal responses. No rights are combined.
- Private browser-restored views and cross-tab session/account changes lacked a common recovery boundary. SessionBoundary checks the live account and selected organization/project/exact review on focus, authorized invalidation and a 30-second recovery interval; HTTP 401 clears private descendants. Pagehide hides the private snapshot, persisted pageshow reloads it, and denied views offer safe sign-in/account-capacity recovery. API authorization remains authoritative; delivered copies cannot be recalled.
- Filters/pages/cursors were inconsistently recoverable across core, expansion, files, reviews and notifications. They now use URL state with back/forward/reload handling and hydration-consistent subscriptions. Only view state enters the URL, never response bodies, drafts, proof tokens or storage capabilities. Allowlisted, bounded continuations preserve supported filters after reauthentication and reject redirect injection.
- A fast second core filter change could be discarded when loading replaced the form. The form now remains mounted, disables while refreshing, and retains the next selection. Explicit reload/conflict recovery still fetches current revisions. Record forms stay disabled through the committed-data refresh, and each mutation clears earlier success feedback; the management journey asserts the persisted lifecycle state after every save. Client and participant filters use their actual lifecycle states; sort choices are limited to fields supported by each API resource, and My Tasks omits irrelevant assignee/milestone controls while using accessible project choices. Portal project listings no longer offer a nonfunctional review-status control. Participant options and permission discovery traverse every roster page instead of stopping at 100. Project Manager edits retain the immutable current client instead of requiring an organization-wide client selector that Managers cannot populate; a separate Manager browser saves and reloads project metadata.
- P25 exposed only review status although the approved actions include deadlines and exact versions. The UI now connects due-before and strict exact-version filtering, scoped counts and persisted filters. The parameterized read predicate cannot retarget a cycle or disclose a foreign version.
- File upload status and listing were fetched in parallel, so a newly observed READY could stop polling after an older empty listing read. The UI now performs one final authorized list refresh after first observing each committed READY result; the browser asserts the listing appears without manual reload.
- P33 silently stopped after 100 milestones. Its current-grant-authorized overview now supplies a count and deterministic position/ID pages; the portal has next/previous/reload controls. The new real browser fixture traverses 26 milestones across two pages and then proves revocation clears the project.
- Completed/archived project work now explicitly reads as read only, with work mutation controls removed while lifecycle/access inspection remains available under the existing policy. Terminal/superseded internal reviews no longer offer the open-cycle replacement control; their history/resolution/conversion paths remain. Checklist/folder removal and discussion/document archival have confirmations. Duplicate submission guards and status feedback cover record saves, invitations, archives and existing file/review operations.
- The organization selector now has an explicit accessible name. A skip link, visible keyboard focus, one main landmark, grouped save errors and responsive table/image bounds improve functional access without adding a design system.

## 4. Complete cross-module workflow inventory

| Journey               | Actual exercised transitions and evidence                                                                                                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity/account      | Register → real Mailpit verification → login → account/profile/password/sessions → logout/recovery/reset; Phase 2 API/browser, Phase 8 stale-session browser                                                                        |
| Organization/team     | Onboarding → reauthenticate → settings/team invitations → intended acceptance → principal selection; two organizations and role/status edits in Phase 8                                                                             |
| Client/access         | Client/contact → invitation → separate client contact/grant → portal; Phase 3/5 suites and Phase 8 two contacts in the same organization                                                                                            |
| Project lifecycle     | Create with client → participation → active work → completion denied with outstanding task → DONE/milestone completion → explicit completion/reopen/archive; Phase 3 plus Phase 8 browser                                           |
| Tasks/milestones      | Task assignment/milestone/priority/order → checklist toggle/edit/removal → threads/replies/history → reload; Phase 3 and Phase 8                                                                                                    |
| Files/deliverables    | Folder creation/rename/empty removal → offline attempt with retained selection → real upload retry/READY → listing archive → task-to-deliverable continuation/link/unlink → prepare/download immutable version; Phase 4 and Phase 8 |
| Immutable history     | N/N+1 preparation and exact byte/digest reads → explicit sharing → retained version history; Phase 4/5 API/browser                                                                                                                  |
| Client review         | Exact shared image/PDF → zoom/rotation/page/numeric or click pin → feedback/reply → eligible digest confirmation → exact-version decision; deliberate replacement/races in Phase 5                                                  |
| Feedback/task         | Internal conversion → one durable source task → original-feedback backlink → retained review; client task non-disclosure, Phase 5 browser/API                                                                                       |
| Notifications         | Durable assignment/review/discussion/document/update event → recipient read/filter/mark → authorized link → saved preferences → offline/reconnect REST catch-up; Phase 6/7                                                          |
| Collaboration/history | Project discussions/replies/activity → document library/editor/formatted save/reload/conflict/archive → reports/audit; Phase 7 plus Phase 8 shared navigation/archive/filter history                                                |
| Client updates        | P16 publication → client aggregate/project filter → exact review/project link → withdrawal/revocation; Phase 7/8                                                                                                                    |

## 5. Role/capacity navigation and permission verification

All final Phase 2–8 API suites use actual sessions, restricted PostgreSQL roles and real native services. They cover Owner/Admin/Member, project Manager/Contributor/Viewer, unassigned/inactive users and separate client Viewer/Reviewer/named Approver behavior. Tests exercise tenant/project ancestry, malformed/foreign identifiers, inactive membership/grant/share/portal state, RLS and field/transition checks. Client affiliation alone grants nothing. Formal decisions still require the frozen exact-version roster and current Approver grant; internal administration never supplies client authority.

The Phase 8 browser specifically switches two organization contexts, selects between two contacts for the same user/organization, navigates across portal modules/reloads, revokes the selected grant through the internal UI, and verifies stale project/private headings disappear. Denied recovery retains the main/error landmark while private descendants are removed. The current session is revoked through Account in another tab and the stale internal view is removed. Existing Phase 3/5/6 browser journeys retain Contributor/Viewer/client differences, exact-version approval and notification target isolation.

## 6. Accessibility and functional usability

The management browser also completes confirmed ownership transfer, checks the former Owner returns as Admin with no ownership control, changes that account’s password, signs out and signs in using the new password. The browser exercises the skip link and focus transfer to main, keyboard-operable selects and content editing, actual image/PDF annotation coordinates/zoom/rotation, one main landmark, accessible current-organization/capacity/ownership/team-control names, retained conflict drafts and mobile report layout at 390×844 without page overflow. Existing editor tests cover all supported formatting, safe links/paste/drop and two-window conflict recovery. Recovery and discard hold the editor mutation guard while loading the authoritative revision, so an immediate Save cannot reuse the stale pre-recovery revision. Grouped save errors describe the form; existing labels and native validation remain. Confirmation dialogs and pending-disabled controls protect destructive actions and duplicate clicks.

This is functional accessibility evidence, not a claim of complete WCAG or assistive-technology certification. Styling stays lightweight semantic HTML/CSS and replaceable; no professional redesign, animation framework or editor dependency was introduced.

## 7. New tests

- tests/unit/phase8.test.mjs: bounded safe view-state continuations and redirect injection rejection; strict exact-version/deadline query validation.
- tests/phase8/integration.test.mjs: real scoped review-filter rows/count reconciliation, unchanged cycle facts, malformed input, foreign project/tenant/principal denial and non-disclosure.
- tests/e2e/phase8.spec.ts: five real browser journeys covering connected navigation/filter history/mobile/keyboard/editor archive; exact-version filters/session clearing; dual contact capacity/milestone paging/grant revocation; work/client/member lifecycle/checklist removal/ownership transfer/password change; offline upload retry/folder administration/task linkage/version preparation/download/archive.
- package.json exposes pinned test:phase8 and test:e2e:phase8 aliases. OpenAPI generation now documents overview pagination and the exact-version filter; generated client/DTO output is refreshed. Documentation checks include this report and the 36-page action inventory.

No security-critical HTTP, authorization, database, scanning, storage or formal decision flow is mocked. Browser fixtures are synthetic and local; the offline case changes actual browser network availability, retains the selected file, then retries through the real pipeline.

## 8. Regression results

All commands run from D:\Devworkspace. Private raw logs remain under ignored .local/phase8. [Sanitized final command record](verification/phase8-final.txt) contains final exits/counts; [preservation inventory](verification/phase8-files.json) records source/migration/role evidence. Earlier failed attempts are described below and never counted as passes.

| Actual command                                   | Result                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| pnpm build                                       | PASS; final full workspace production build, exit 0                                        |
| pnpm --filter @devworkspace/web build            | PASS; focused builds during integration; final full build includes web                     |
| pnpm check                                       | PASS; runtime/boundaries/docs/infra/OpenAPI/env/lint/typecheck, 15/15 units and formatting |
| pnpm test:native (apps stopped)                  | PASS 7/7, retained native lifecycle                                                        |
| pnpm test:integration (isolated experiment mode) | PASS 20/20                                                                                 |
| pnpm test:e2e:experiment                         | PASS 1/1                                                                                   |
| pnpm test:phase2                                 | PASS 20/20, final backend tree                                                             |
| pnpm test:phase3                                 | PASS 27/27, final backend tree                                                             |
| pnpm test:phase4                                 | PASS 24/24, including eight actual AppContainer/scanner/renderer checks                    |
| pnpm test:phase5                                 | PASS 21/21, final backend including overview pagination                                    |
| pnpm test:phase6                                 | PASS 19/19                                                                                 |
| pnpm test:phase7                                 | PASS 13/13                                                                                 |
| pnpm test:phase8                                 | PASS 2/2                                                                                   |
| pnpm test:e2e                                    | PASS 1/1, final browser rerun                                                              |
| pnpm test:e2e:phase3                             | PASS 2/2, final browser rerun                                                              |
| pnpm test:e2e:phase4                             | PASS 3/3; final UI                                                                         |
| pnpm test:e2e:phase5                             | PASS 2/2; final UI and repeat-safe immutable-cycle fixture                                 |
| pnpm test:e2e:phase6                             | PASS 1/1; final UI                                                                         |
| pnpm test:e2e:phase7                             | PASS 1/1; final UI and unique retained-history publication fixture                         |
| pnpm test:e2e:phase8                             | PASS 5/5; final UI including ownership/password/session/Manager/upload recovery            |
| pnpm check:docs; git diff --check                | PASS; final report/evidence verification recorded in phase8-final.txt                      |

The initial complete backend sweep passed before the final portal milestone-read extension. A second complete Phase 2–8 sweep passed against the final backend. Final browser runs use the final UI after restarting the production-mode local web process; no source/build changes occur during that last browser sweep.

## 9. Failures discovered and corrections

1. Initial native startup reported a pg_ctl timeout although PostgreSQL reached readiness; ownership-checked retry succeeded. After a later interrupted interval, PostgreSQL logs recorded Windows exception 0x40010004, process termination/reinitialization, then retained-data fsync/WAL recovery. Initial Phase 8 login/setup returned 503 while PostgreSQL was unavailable. No test assertion was relaxed; native recovery/readiness and unchanged API/browser reruns followed. No definitive cause for the external Windows exception is claimed.
2. A new browser test reproduced the filter-refresh form replacement race. Keeping the form mounted/disabled during refresh corrected it; back/reload and subsequent filters pass.
3. An exact organization-label lookup exposed the selector's ambiguous implicit label. Its explicit accessible name fixes actual keyboard/test discovery. The new management test initially expected a generic conflict, while the real API returned its more useful outstanding-task message; the assertion now checks that exact approved behavior.
4. Test setup initially read the earlier invitation email before the second matching subject arrived. It now correlates a not-yet-consumed proof before acceptance. Alert assertions exclude Next's separate route announcer without weakening the actual denial-text assertion.
5. A later retained role browser exposed nondeterministic denial ordering: the shared boundary could clear the original main before the page-local alert rendered. Denied views now retain a single safe main landmark and compatible organization-unavailable wording, while private children stay removed.
6. The upload browser then reproduced READY/listing read skew. One committed-state refresh closes that race; its listing assertion was retained and made explicit.
7. The extended lifecycle journey also exposed a subsequent save racing committed-data refresh: old success feedback could be read before the latest project transition finished, and a form could be edited before reinitialization. Save feedback now resets immediately and forms remain disabled through refresh. The regression checks actual displayed committed states and then archives the client only after its project is archived.
8. Some retained browser attempts failed to find the login page while a replacement production build was being written. The build/process was stabilized and the complete browser sweep rerun. These page-load failures are distinct from the Phase 7 report's intermittent login P2028; no P2028 root cause or load guarantee is claimed.
9. The retained Phase 5 browser suite was rerun against its previously consumed PDF cycle and correctly found CHANGES_REQUESTED instead of OPEN. Its setup now reads that immutable state, reuses an existing authorized OPEN cycle or explicitly creates a fresh cycle on the same still-unapproved version. It never rewrites terminal facts or removes the OPEN assertion. A new assertion checks that superseded internal reviews offer no replacement action. The subsequent repeat passed 2/2; the final rebuild is followed by another focused run.
10. The retained document conflict browser reproduced Save racing the asynchronous revision-recovery GET. Recovery/discard now hold the same pending guard as Save, preserve the draft and release it only after the authoritative revision is selected. The existing conflict assertions are unchanged.
11. Repeated Phase 7 browser publication used a constant body that collided with retained WITHDRAWN history. Each synthetic run now uses a unique body and still asserts the exact new publication, client visibility and withdrawal; no historical row is deleted and no assertion is relaxed.
12. Type/lint checks caught an optional role-prop mismatch and an unused navigation variable during extraction; both were corrected. One initial test:phase8 invocation preceded adding its alias and therefore ran no tests. Actual passing counts come only from the installed pinned commands after alias creation.

## 10. Known limits retained for Phase 9

The Phase 7 scoped-set-before-pagination memory/scalability limit remains; this phase fixes functional navigation/pages rather than certifying load. Organization serialization and live per-recipient checks prioritize correctness. The older intermittent login/browser timeout observation remains for measured system hardening; the final runs do not establish its root cause.

Existing private S3 version-pinning/admin boundary, canonical orphan reconciliation/retention, AppContainer/ACL/CVD freshness, sampled disk budget, hard-crash processing residue/operator recovery and development-only native infrastructure limitations are unchanged. Full V08 database/object restore/retention/checksum certification, production operations and resource/load certification remain separately authorized Phase 9 work. Already downloaded/in-flight content cannot be recalled; SMTP exactly-once delivery is not claimed.

## 11. Changed files and data preservation

Shared navigation/view state/session recovery live in new apps/web/app/navigation.tsx, view-state.ts and session-boundary.tsx. Existing core/flows/files/reviews/expansion/notifications/layout/auth/routes/CSS and public introduction are integrated. The only server change is the scoped review filter and portal milestone read/count/page extension in packages/server/src/reviews.ts; contracts and generated output follow it. Tests, package aliases, OpenAPI/document checks, current authority/runbooks, feature ledger, action inventory and this report are updated. The complete filename list is in the preservation inventory.

The pre-edit private baseline contains 246 files, including ignored local configuration hashes. There are zero missing baseline files; all 43 prior SQL files are unchanged, and all 43 applied migration ledger hashes match source. The lockfile and local environment are unchanged. All 46 tenant tables still enable/force RLS and runtime/purpose roles retain their no-superuser/no-BYPASSRLS flags. The existing global self-scoped onboarding_receipt is explicitly reported separately, not misrepresented as a tenant RLS table.

No migration was added or rewritten, no dependency upgraded/installed, no database reset, canonical purge, credential change, Git staging/reset/clean, commit, push, external delivery or deployment occurred. Lifecycle and failure tests use owned processes and their bounded synthetic probes. Original databases, immutable bytes and local processing configuration remain retained. This preservation evidence does not substitute for the deferred full cross-store restore rehearsal.

## 12. Outstanding functional gaps

None for the approved Phase 8 local functional-integration scope. All 36 action inventories, cross-module journeys, relevant role/capacity denial and recovery checks are mapped to passing runtime evidence. The explicit Phase 9 operational/certification limits in section 10 remain. No ERP/finance/HR/billing module, infrastructure replacement or professional design was introduced.

## 13. Recommendation and phase gate

Review this completed Phase 8 result and its evidence. Stop here; user acceptance and separate next-phase authorization remain required. The exact recommended separately authorized next scope is Phase 9 final system certification: full T01–T25 reconciliation, V08 database/object restore and retention verification, resource/load/query-pagination measurements and native process/auth timing hardening. Do not start Phase 9 or professional design automatically.
