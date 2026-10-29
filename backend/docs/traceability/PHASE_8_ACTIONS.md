# Phase 8 — 36-template action inventory

Date: 2026-10-19. Scope: approved Phase 8 only. This inventory compares the approved PRODUCT_SPEC and FEATURE_MATRIX with actual components, contracts and tests. Runtime verdicts are recorded separately in PHASE_8_REPORT.md; a control or route alone is not proof. Operation families below are concise references; exact identifiers/DTOs remain in packages/contracts/src/operations.ts and generated OpenAPI.

Every protected page additionally requires live session, selected capacity, tenant/resource ancestry and current policy. Common states: loading, empty, validated input, network/server failure, 401/session recovery, safe 403/404, stale revision/conflict, pending submit and retry. SessionBoundary clears denied/different-account views and reloads browser-restored snapshots; view-state stores filters/cursors only. All entry/return paths use ordinary full navigation.

## P01 — Landing

- Route/tier: `/`; Core; Phase 2. Features: FR20.
- Actions/permissions: anyone reads an accurate product introduction and follows Register/Login links. No fake customer statistics or demo operations.
- States/dependencies: public content and authenticated navigation; web plus session summary if signed in.
- Actual controls: Public header Register/Sign in links.
- Implementation: apps/web/app/page.tsx + flows.tsx; API families: Public introduction; identity commands through P02/P03.
- Entry/return paths: Public header/auth continuation and Account; invitation proof removed from URL.
- Existing browser coverage: tests/e2e/phase2.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: Corrected stale product availability copy and removed the implementation-only experiment entry from public product navigation.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.

## P02 — Login

- Route/tier: `/login`; Core; Phase 2. Features: FR01.
- Actions/permissions: authenticate email/password, sign out, follow recovery; signed-in users choose only their valid memberships/client grants.
- States/dependencies: invalid credentials, unverified email with resend, throttled, session expired; Identity and rate limits.
- Actual controls: Email/password, verification resend, recovery and capacity selector.
- Implementation: apps/web/app/flows.tsx; API families: identityLogin/identityLogout; accountPrincipals.
- Entry/return paths: Public header/auth continuation and Account; invitation proof removed from URL.
- Existing browser coverage: tests/e2e/phase2.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: Preserved actual approved actions; shared session expiry/restored-view handling and safe continuation apply.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.

## P03 — Register

- Route/tier: `/register`; Core; Phase 2. Features: FR01.
- Actions/permissions: create identity and confirm email using an embedded verification state. Registration alone grants no tenant access.
- States/dependencies: validation, generic duplicate response, verification pending/expired/replayed, delivery retry; Identity and local mail adapter/outbox.
- Actual controls: Display name/email/password, Verify email and resend.
- Implementation: apps/web/app/flows.tsx; API families: identityRegister/identityVerify/identityResend.
- Entry/return paths: Public header/auth continuation and Account; invitation proof removed from URL.
- Existing browser coverage: tests/e2e/phase2.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: Preserved actual approved actions; shared session expiry/restored-view handling and safe continuation apply.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.

## P04 — Forgot Password

- Route/tier: `/forgot-password`; Core; Phase 2. Features: FR01.
- Actions/permissions: anyone requests recovery with a uniform response; rate limits apply.
- States/dependencies: submitted, throttled, generic delivery failure/retry handling; Identity and durable mail dispatch.
- Actual controls: Recovery email and Send reset link.
- Implementation: apps/web/app/flows.tsx; API families: identityRecovery.
- Entry/return paths: Public header/auth continuation and Account; invitation proof removed from URL.
- Existing browser coverage: tests/e2e/phase2.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: Preserved actual approved actions; shared session expiry/restored-view handling and safe continuation apply.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.

## P05 — Reset Password

- Route/tier: `/reset-password`; Core; Phase 2. Features: FR01.
- Actions/permissions: holder of valid recovery proof sets a password; identity is derived from that proof, not a supplied user ID.
- States/dependencies: invalid/expired/used token, validation, success; Identity token consumption and session invalidation.
- Actual controls: Proof-bound New password and Reset password.
- Implementation: apps/web/app/flows.tsx; API families: identityReset.
- Entry/return paths: Public header/auth continuation and Account; invitation proof removed from URL.
- Existing browser coverage: tests/e2e/phase2.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: Preserved actual approved actions; shared session expiry/restored-view handling and safe continuation apply.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.

## P06 — Accept Invitation

- Route/tier: `/invitations/accept`; Core; Phase 2 internal acceptance, Phase 3 client/grant extension, Phase 5 portal return. Features: FR01, FR02, FR11.
- Actions/permissions: verified intended email accepts an internal or client invitation after authentication; shows organization, capacity, and proposed grants.
- States/dependencies: pending sign-in, email mismatch, expired/revoked/used, success; Identity, Organizations, Clients, Access.
- Actual controls: Review invitation and explicit accept internal/client buttons.
- Implementation: apps/web/app/flows.tsx; API families: invitationInspect/invitationAccept.
- Entry/return paths: Public header/auth continuation and Account; invitation proof removed from URL.
- Existing browser coverage: tests/e2e/phase2.spec.ts, tests/e2e/phase3.spec.ts, tests/e2e/phase5.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: Preserved actual approved actions; shared session expiry/restored-view handling and safe continuation apply.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.

## P07 — Organization Onboarding

- Route/tier: `/onboarding`; Core; Phase 2. Features: FR01, FR02.
- Actions/permissions: verified signed-in user creates an agency and its first Owner membership; client invitation flow leads to portal instead.
- States/dependencies: incomplete profile, validation, repeated submission, created; Organizations and Identity.
- Actual controls: Organization name/description/timezone and Create organization.
- Implementation: apps/web/app/flows.tsx; API families: organizationCreate.
- Entry/return paths: Public header/auth continuation and Account; invitation proof removed from URL.
- Existing browser coverage: tests/e2e/phase2.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: Preserved actual approved actions; shared session expiry/restored-view handling and safe continuation apply.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.

## P08 — Dashboard

- Route/tier: `/w/:orgId`; Core; Phase 3. Features: FR04, FR06.
- Actions/permissions: internal users inspect accessible projects, upcoming deadlines, assigned work, and review summaries; links respect project rights.
- States/dependencies: no projects/work, partial read failure; Projects, Tasks, Milestones, later Reviews.
- Actual controls: Project links, assigned deadline links, milestone/review summaries.
- Implementation: apps/web/app/core.tsx; API families: dashboard/myTasks/reviewsList.
- Entry/return paths: Organization selector → shared workspace navigation → project navigation/detail/source links; Account remains reachable.
- Existing browser coverage: tests/e2e/phase3.spec.ts, tests/e2e/phase5.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: Preserved actual approved actions; shared session expiry/restored-view handling and safe continuation apply.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.

## P09 — Projects

- Route/tier: `/w/:orgId/projects`; Core; Phase 3. Features: FR04.
- Actions/permissions: internal users list/filter accessible projects; Owner/Admin create, choose client, appoint Managers; Managers update/archive assigned projects.
- States/dependencies: no accessible projects, archived filter, stale update; Projects, Clients, Access.
- Actual controls: Client selection, project create/edit, lifecycle, search/status/sort/pages.
- Implementation: apps/web/app/core.tsx; API families: projectsList/Create/Update.
- Entry/return paths: Organization selector → shared workspace navigation → project navigation/detail/source links; Account remains reachable.
- Existing browser coverage: tests/e2e/phase3.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: Preserved actual approved actions; shared session expiry/restored-view handling and safe continuation apply.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.

## P10 — My Tasks

- Route/tier: `/w/:orgId/my-tasks`; Core; Phase 3. Features: FR06.
- Actions/permissions: internal user filters own assigned tasks by status, priority, project and due window, updates permitted work status/checklist completion, and opens Task Details; assignment administration remains Manager-only.
- States/dependencies: none assigned, overdue, incomplete checklist, assignment revoked, stale update; Work, Projects, Access.
- Actual controls: Own assignment list with project/status/priority/deadline filters and task links.
- Implementation: apps/web/app/core.tsx; API families: myTasks/tasksUpdate/checklistUpdate.
- Entry/return paths: Organization selector → shared workspace navigation → project navigation/detail/source links; Account remains reachable.
- Existing browser coverage: tests/e2e/phase3.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: Replaced manual project UUID filtering with accessible project choices; URL state recovers the choice; irrelevant assignee/milestone controls are omitted.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.

## P11 — Clients

- Route/tier: `/w/:orgId/clients`; Core; Phase 3. Features: FR03.
- Actions/permissions: Owner/Admin create/manage/archive clients; Members read only limited client summaries associated with accessible projects.
- States/dependencies: empty, archived, cannot archive with active projects; Clients and Projects.
- Actual controls: Client create/edit, search/status/pages and detail links.
- Implementation: apps/web/app/core.tsx; API families: clientsList/Create/Update.
- Entry/return paths: Organization selector → shared workspace navigation → project navigation/detail/source links; Account remains reachable.
- Existing browser coverage: tests/e2e/phase3.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: Corrected client status filter choices to ACTIVE/ARCHIVED and offered only supported resource sort fields.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.

## P12 — Client Details

- Route/tier: `/w/:orgId/clients/:clientId`; Core; Phase 3. Features: FR03, FR04, FR11.
- Actions/permissions: Owner/Admin edit client/contact identities and invitations; project Managers may read contacts for their client's assigned projects and manage grants on P23. Others see only permitted summary/projects.
- States/dependencies: no contacts/projects, pending invite, archived; Clients, Invitations, Access.
- Actual controls: Contact create/edit/status, invitation issue/revoke and project links.
- Implementation: apps/web/app/core.tsx; API families: clientsRead/contactsList/Create/Update/clientInvitationCreate/invitationRevoke.
- Entry/return paths: Organization selector → shared workspace navigation → project navigation/detail/source links; Account remains reachable.
- Existing browser coverage: tests/e2e/phase3.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: Preserved actual approved actions; shared session expiry/restored-view handling and safe continuation apply.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.

## P13 — Team Management

- Route/tier: `/w/:orgId/team`; Core; Phase 2. Features: FR01, FR02.
- Actions/permissions: Owner/Admin list internal team, invite, change roles, revoke invitations, deactivate memberships; Owner controls ownership.
- States/dependencies: pending/revoked/expired invite, last-owner conflict, deactivated member; Organizations, Identity, Audit.
- Actual controls: Invite/revoke, member role/status save and team paging.
- Implementation: apps/web/app/flows.tsx; API families: teamRead/invitationCreate/invitationRevoke/membershipUpdate.
- Entry/return paths: Organization selector → shared workspace navigation → project navigation/detail/source links; Account remains reachable.
- Existing browser coverage: tests/e2e/phase2.spec.ts, tests/e2e/phase3.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: Shared workspace return links; Member navigation omits team administration.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.

## P14 — Notifications

- Route/tier: `/w/:orgId/notifications`; Core; Phase 6. Features: FR12.
- Actions/permissions: internal recipients list own notifications, mark read, open still-authorized resources. Clients receive permitted badges/notifications within the portal layout, reusing this component without another template.
- States/dependencies: empty, unread/read, revoked target, delayed delivery; Notifications, Outbox, Realtime, Access.
- Actual controls: Category/read-state/pages, authorized target links, mark/read-all and refresh.
- Implementation: apps/web/app/notifications.tsx; API families: notificationsList/notificationRead/notificationsReadAll.
- Entry/return paths: Organization selector → shared workspace navigation → project navigation/detail/source links; Account remains reachable.
- Existing browser coverage: tests/e2e/phase6.spec.ts, tests/e2e/phase7.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: Read/category/page state survives navigation/reload.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.

## P15 — Reports & Analytics

- Route/tier: `/w/:orgId/reports`; Expansion; Phase 7. Features: FR16.
- Actions/permissions: internal users filter permitted delivery/review summaries by project/date; Owner/Admin see tenant totals, Members only accessible projects.
- States/dependencies: insufficient/no data, invalid date window; Reporting read services over Projects/Tasks/Reviews.
- Actual controls: Project/date filters, live-state and terminal-review metrics table.
- Implementation: apps/web/app/expansion.tsx; API families: reportsRead.
- Entry/return paths: Organization selector → shared workspace navigation → project navigation/detail/source links; Account remains reachable.
- Existing browser coverage: tests/e2e/phase7.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: Filters and cursors are now URL state with back/forward/reload recovery.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.

## P16 — Project Overview

- Route/tier: `/w/:orgId/projects/:projectId`; Core; Phase 3. Features: FR04, FR05, FR06, FR09.
- Actions/permissions: authorized internal users inspect project, client, milestones, work progress, and version-specific review summaries; Managers update lifecycle metadata.
- States/dependencies: planned/active/completed/archived, no tasks, stale update; Projects, Milestones, Tasks, later Reviews.
- Actual controls: Project metadata/lifecycle save, client/milestone/review links, publish/withdraw client update.
- Implementation: apps/web/app/core.tsx + expansion.tsx; API families: projectsRead/Update/clientUpdatesCreate/Withdraw.
- Entry/return paths: Organization selector → shared workspace navigation → project navigation/detail/source links; Account remains reachable.
- Existing browser coverage: tests/e2e/phase3.spec.ts, tests/e2e/phase5.spec.ts, tests/e2e/phase7.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: Preserved actual approved actions; shared session expiry/restored-view handling and safe continuation apply.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.

## P17 — Task Board

- Route/tier: `/w/:orgId/projects/:projectId/tasks`; Core; Phase 3. Features: FR06.
- Actions/permissions: Managers create/assign/reorder tasks and set priority/deadlines/status; Contributors change own assigned work state; Viewers read. Filter by status, assignee, priority and due window; a select/button workflow suffices.
- States/dependencies: empty column/filter, blocked/overdue task, stale revision; Work, Access.
- Actual controls: Task create/edit/order/assignee/deadline, status/priority filters and detail links.
- Implementation: apps/web/app/core.tsx; API families: tasksList/Create/Update.
- Entry/return paths: Organization selector → shared workspace navigation → project navigation/detail/source links; Account remains reachable.
- Existing browser coverage: tests/e2e/phase3.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: Participant roster traverses every API page, including permission/assignment selection beyond the first 100.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.

## P18 — Task Details

- Route/tier: `/w/:orgId/projects/:projectId/tasks/:taskId`; Core; Phase 3, review origin in Phase 5. Features: FR05, FR06, FR08, FR10.
- Actions/permissions: internal users read task/checklist/comments/history. Managers edit metadata, priority, milestone, assignee/deadline and checklist structure; assigned Contributors change work state and check/uncheck items. Managers/Contributors add internal task threads/replies. Show authorized deliverable links and, when present, the source feedback link.
- States/dependencies: unassigned, overdue, empty/incomplete checklist, no comments/history, stale update, archived/completed project; Work, Milestones, Access; Files/Deliverables in Phase 4 and Reviews in Phase 5.
- Actual controls: Task edit/work state, checklist create/toggle/edit/remove, threads/replies/history, original feedback and deliverable links.
- Implementation: apps/web/app/core.tsx; API families: tasksRead/Update/checklistList/Create/Update/Remove/commentsList/Create/historyList.
- Entry/return paths: Organization selector → shared workspace navigation → project navigation/detail/source links; Account remains reachable.
- Existing browser coverage: tests/e2e/phase3.spec.ts, tests/e2e/phase5.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: Confirmed checklist removal; repeated submits guarded and drafts retained on failed saves.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.

## P19 — Milestones

- Route/tier: `/w/:orgId/projects/:projectId/milestones`; Core; Phase 3. Features: FR05.
- Actions/permissions: internal project users read; Managers create, edit, order, and explicitly complete milestones.
- States/dependencies: empty, open, completed, overdue, incomplete-task conflict; Milestones and Tasks.
- Actual controls: Milestone title/deadline/order/status saves and progress.
- Implementation: apps/web/app/core.tsx; API families: milestonesList/Create/Update.
- Entry/return paths: Organization selector → shared workspace navigation → project navigation/detail/source links; Account remains reachable.
- Existing browser coverage: tests/e2e/phase3.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: Preserved actual approved actions; shared session expiry/restored-view handling and safe continuation apply.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.

## P20 — Project Discussions

- Route/tier: `/w/:orgId/projects/:projectId/discussions`; Expansion; Phase 7. Features: FR13.
- Actions/permissions: internal Managers/Contributors create topics and replies; Viewers read; Managers archive topics.
- States/dependencies: empty, open/archived topic, validation; Collaboration, Access, Activity.
- Actual controls: Create/search/page topics, open/read/reply, archive confirmation.
- Implementation: apps/web/app/expansion.tsx; API families: discussionsList/Create/Read/Archive/discussionRepliesList/Create.
- Entry/return paths: Organization selector → shared workspace navigation → project navigation/detail/source links; Account remains reachable.
- Existing browser coverage: tests/e2e/phase7.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: Shared full project navigation; persisted search/status/cursor state and archive confirmation.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.

## P21 — Project Files

- Route/tier: `/w/:orgId/projects/:projectId/files`; Core; Phase 4. Features: FR07.
- Actions/permissions: internal users browse/filter root or one logical folder and download clean files; Managers/Contributors upload into an existing same-project folder or root; Managers create/rename folders, move file listings and remove empty folders.
- States/dependencies: empty root/folder, duplicate folder name, nonempty-folder deletion conflict, uploading/quarantined/scanning/ready/rejected/failed/expired; Files, Storage, Worker, Access.
- Actual controls: Root/folder selection/pages, create/rename/remove empty folders, upload/retry/status, listing move/rename/archive, preview/download.
- Implementation: apps/web/app/files.tsx; API families: foldersList/Create/Update/Remove/filesList/Update/uploadsCreate/uploadFinalize/uploadRetry/assetPreview/Download.
- Entry/return paths: Organization selector → shared workspace navigation → project navigation/detail/source links; Account remains reachable.
- Existing browser coverage: tests/e2e/phase4.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: Full project return links and recoverable folder/search/status/page state; one final listing refresh after committed READY, plus empty-folder removal confirmation.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.

## P22 — Deliverables

- Route/tier: `/w/:orgId/projects/:projectId/deliverables`; Core; Phase 4, review controls in Phase 5. Features: FR08, FR09.
- Actions/permissions: internal users read version history; Managers/Contributors create project-owned deliverables with optional same-project task link and prepare immutable versions; Managers manage task links, share/revoke versions, open/cancel reviews, or explicitly replace an open review with a newer ready/shared version.
- States/dependencies: no versions, unlinked task, processing, internal/shared, latest prepared version distinct from active review target, terminal review, replacement conflict; Deliverables, Files, Work, Reviews, Access.
- Actual controls: Create/link/unlink/archive deliverable, upload/prepare/download/version history and project Reviews navigation for share/open/replace.
- Implementation: apps/web/app/files.tsx + reviews.tsx; API families: deliverablesList/Create/Update/versionPrepare/versionsList/versionShare/reviewOpen/Replace.
- Entry/return paths: Organization selector → shared workspace navigation → project navigation/detail/source links; Account remains reachable.
- Existing browser coverage: tests/e2e/phase4.spec.ts, tests/e2e/phase5.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: Direct project Reviews entry added to the shared navigation; version page state persists.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.

## P23 — Project Team & Access

- Route/tier: `/w/:orgId/projects/:projectId/access`; Core; Phase 3, client review rules in Phase 5. Features: FR04, FR11.
- Actions/permissions: internal project users see a permitted roster; Managers manage same-tenant internal assignments and same-client contact grants; only Owner/Admin invite/change organization membership.
- States/dependencies: no contacts, pending invite, revoked grant, approver affected by open review; Access, Organizations, Clients, Reviews.
- Actual controls: Organization member/project role and client contact/grant/status selection, edit/save.
- Implementation: apps/web/app/core.tsx; API families: membersList/Create/Update/projectCandidates/grantsList/Create/Update.
- Entry/return paths: Organization selector → shared workspace navigation → project navigation/detail/source links; Account remains reachable.
- Existing browser coverage: tests/e2e/phase3.spec.ts, tests/e2e/phase5.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: Preserved actual approved actions; shared session expiry/restored-view handling and safe continuation apply.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.

## P24 — Project Activity

- Route/tier: `/w/:orgId/projects/:projectId/activity`; Expansion; Phase 7. Features: FR14.
- Actions/permissions: authorized internal project users browse paginated/filterable lifecycle events.
- States/dependencies: no events, delayed projection, archived project; Activity, Outbox, Access.
- Actual controls: Action/date filters, cursor navigation, delayed activity refresh.
- Implementation: apps/web/app/expansion.tsx; API families: projectActivityList.
- Entry/return paths: Organization selector → shared workspace navigation → project navigation/detail/source links; Account remains reachable.
- Existing browser coverage: tests/e2e/phase7.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: Preserved actual approved actions; shared session expiry/restored-view handling and safe continuation apply.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.

## P25 — Review Center

- Route/tier: `/w/:orgId/reviews`; Core; Phase 5. Features: FR09.
- Actions/permissions: internal users list/filter accessible review cycles by status/deadline/exact version; Managers open a cycle on an explicitly selected eligible shared version, or use the replacement action when a cycle is already open.
- States/dependencies: empty, open, approved, changes requested, cancelled, superseded; latest prepared version may differ from active review; Reviews, Deliverables, Access.
- Actual controls: Status, due-before and exact-version filters; cycle links; project review management.
- Implementation: apps/web/app/reviews.tsx; API families: reviewsList/projectReviews/reviewOpen.
- Entry/return paths: Organization selector → shared workspace navigation → project navigation/detail/source links; Account remains reachable.
- Existing browser coverage: tests/e2e/phase5.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: Connected existing due-before policy; added exact-version filtering with scoped counts and strict contract; URL recovery.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.

## P26 — Review Workspace

- Route/tier: `/w/:orgId/projects/:projectId/reviews/:reviewId`; Core; Phase 5. Features: FR06, FR09, FR10.
- Actions/permissions: internal users inspect exact bytes/annotations/history; Managers/Contributors add permitted feedback/resolution events. Managers cancel or explicitly replace an open review and create an internal task from a readable feedback thread, selecting valid task fields/assignment. Internal roles never grant client decision authority.
- States/dependencies: preview unavailable, open/read-only terminal cycle, replacement conflict, task already created, invalid assignee, inactive project; Reviews, Feedback, Work, Files, Access.
- Actual controls: Exact preview/download, page/zoom/rotation, click or numeric annotation, feedback/reply/resolution, cancel/replace, convert/source links.
- Implementation: apps/web/app/reviews.tsx; API families: reviewRead/Preview/Download/FeedbackCreate/Reply/Resolve/Task/Cancel/Replace.
- Entry/return paths: Organization selector → shared workspace navigation → project navigation/detail/source links; Account remains reachable.
- Existing browser coverage: tests/e2e/phase5.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: Complete project/workspace navigation; review list/version/feedback page state persists; terminal cycles do not offer open-cycle replacement.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.

## P27 — Documents Library

- Route/tier: `/w/:orgId/documents`; Expansion; Phase 7. Features: FR15.
- Actions/permissions: internal users browse/search documents from accessible projects; Managers/Contributors create a document in an authorized active project.
- States/dependencies: empty, archived document/project, forbidden destination; Documents and Access.
- Actual controls: Search/project/status/cursors, document create and destination selection.
- Implementation: apps/web/app/expansion.tsx; API families: documentsList/Create.
- Entry/return paths: Organization selector → shared workspace navigation → project navigation/detail/source links; Account remains reachable.
- Existing browser coverage: tests/e2e/phase7.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: Project/search/status/cursor state now survives reload and returns.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.

## P28 — Document Editor

- Route/tier: `/w/:orgId/projects/:projectId/documents/:documentId`; Expansion; Phase 7. Features: FR15.
- Actions/permissions: Managers/Contributors author formatted text using a minimal working toolbar/editor for headings, bold, italic, links, bulleted and numbered lists; Viewers read; Managers archive. A plain textarea alone does not satisfy this scope.
- States/dependencies: unsaved/saving/saved, invalid link/content, unsupported pasted formatting, revision conflict, read-only; Documents, Access, Activity.
- Actual controls: Structured editor/toolbar, safe link/paste/drop, save/reload, stale draft recovery and archive.
- Implementation: apps/web/app/expansion.tsx; API families: documentsRead/Save/Archive.
- Entry/return paths: Organization selector → shared workspace navigation → project navigation/detail/source links; Account remains reachable.
- Existing browser coverage: tests/e2e/phase7.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: One main landmark and shared project return paths; visual editor conflict recovery/discard holds the pending guard until the current revision is loaded.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.

## P29 — Organization Settings

- Route/tier: `/w/:orgId/settings`; Core; Phase 2 text/settings, Phase 4 logo. Features: FR02, FR07, FR18.
- Actions/permissions: Owner/Admin edit agency name, plain-text description and display timezone; upload/replace/remove a logo once the real image pipeline exists. Owner transfers ownership to a verified active internal member with recent authentication.
- States/dependencies: validation, saved/stale settings, reauthentication, image processing/rejected/ready; Organizations, Identity, Audit; Files/Worker in Phase 4.
- Actual controls: Name/description/timezone save, logo upload/attach/remove, confirmed ownership transfer.
- Implementation: apps/web/app/flows.tsx + files.tsx; API families: organizationRead/Update/ownershipTransfer/logo operations.
- Entry/return paths: Organization selector → shared workspace navigation → project navigation/detail/source links; Account remains reachable.
- Existing browser coverage: tests/e2e/phase2.spec.ts, tests/e2e/phase4.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: Workspace return navigation, explicit ownership/control labels and real confirmed ownership transfer/reauthentication verification, preserving settings and ownership policies.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.

## P30 — Audit Log

- Route/tier: `/w/:orgId/audit`; Expansion; Phase 7. Features: FR17.
- Actions/permissions: Owner/Admin browse and filter tenant audit metadata; no UI or API edits/deletes.
- States/dependencies: empty, date/action/actor filters, pagination; Audit and Access.
- Actual controls: Action/actor/date filters and cursor/first-page read-only metadata browser.
- Implementation: apps/web/app/expansion.tsx; API families: auditList.
- Entry/return paths: Organization selector → shared workspace navigation → project navigation/detail/source links; Account remains reachable.
- Existing browser coverage: tests/e2e/phase7.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: Scoped filters and cursor state persist; Members have no audit navigation.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.

## P31 — My Account

- Route/tier: `/account`; Core; Phase 2 account, Phase 4 profile image, Phase 6 notification preferences with Phase 7 category extensions. Features: FR01, FR07, FR12, FR18.
- Actions/permissions: authenticated user edits own display name; uploads/replaces/removes own profile image; changes password with recent proof; manages own sessions and basic in-app notification category preferences. Portal reuses this template.
- States/dependencies: validation/conflict/reauthentication/revoked session, image processing/rejection, saved notification preferences; Identity, Files/Worker, Communications.
- Actual controls: Profile/image, password, own-session revoke/pages, all category preferences, separate client capacity inspect/enter.
- Implementation: apps/web/app/flows.tsx + files.tsx + notifications.tsx; API families: accountRead/Update/accountPassword/accountSessions/accountRevokeSession/notificationPreferencesRead/Save/image operations.
- Entry/return paths: Organization selector → shared workspace navigation → project navigation/detail/source links; Account remains reachable.
- Existing browser coverage: tests/e2e/phase2.spec.ts, tests/e2e/phase4.spec.ts, tests/e2e/phase6.spec.ts, tests/e2e/phase7.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: Removed nested anchor inside capacity button; portal link explicitly selects the intended contact; real own-session revocation and password-change/new-login browser verification.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.

## P32 — My Projects

- Route/tier: `/portal/:orgId/projects`; Core; Phase 5. Features: FR11.
- Actions/permissions: active client contacts list explicitly granted, portal-enabled projects and open them.
- States/dependencies: no grants, portal disabled, grant revoked; Portal, Projects, Access.
- Actual controls: Selected contact capacity, granted project links/pages, portal notifications and Updates.
- Implementation: apps/web/app/reviews.tsx; API families: portalProjects/portalNotificationsList.
- Entry/return paths: Account-selected contact → portal Projects → project Overview/Reviews/Updates; no internal project navigation.
- Existing browser coverage: tests/e2e/phase5.spec.ts, tests/e2e/phase6.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: Contact selection persists per organization across review/update pages; no internal workspace link.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.

## P33 — Client Project Overview

- Route/tier: `/portal/:orgId/projects/:projectId`; Core; Phase 5. Features: FR11, FR05.
- Actions/permissions: granted client contacts read curated project status and milestone summaries, then navigate shared deliverables/reviews.
- States/dependencies: no shared material, active/completed/archived, disabled portal; Portal, Projects, Milestones, Reviews.
- Actual controls: Curated project status and paged milestones, shared deliverables/review/update links.
- Implementation: apps/web/app/reviews.tsx; API families: portalProjectOverview.
- Entry/return paths: Account-selected contact → portal Projects → project Overview/Reviews/Updates; no internal project navigation.
- Existing browser coverage: tests/e2e/phase5.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: Removed silent 100-milestone truncation; scoped count and 25-row pages with next/previous/reload.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.

## P34 — Client Deliverables

- Route/tier: `/portal/:orgId/projects/:projectId/deliverables`; Core; Phase 5. Features: FR08, FR11.
- Actions/permissions: granted contacts list active explicitly shared versions, retrieve allowed files, and inspect exact-version reviews/decisions; distinguish the version currently under review from other shared versions.
- States/dependencies: nothing shared, share revoked, historical approval, newer shared version without a review; Portal, Deliverables, Files, Reviews.
- Actual controls: Shared exact-version history/pages/badges/download and cycle links.
- Implementation: apps/web/app/reviews.tsx; API families: portalVersions/portalVersionDownload.
- Entry/return paths: Account-selected contact → portal Projects → project Overview/Reviews/Updates; no internal project navigation.
- Existing browser coverage: tests/e2e/phase5.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: Portal-only project navigation and retained selected contact.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.

## P35 — Client Review Workspace

- Route/tier: `/portal/:orgId/projects/:projectId/reviews/:reviewId`; Core; Phase 5. Features: FR09, FR10, FR11.
- Actions/permissions: Viewers read client-visible content; Reviewers/Approvers annotate/reply while open; named currently eligible Approvers confirm the displayed cycle/version/digest before approve/request changes.
- States/dependencies: no authority, open, terminal/read-only, explicitly superseded, revoked, competing decision/replacement; Portal, Reviews, Feedback, Files.
- Actual controls: Image/PDF numeric/click annotations/replies; named Approver digest confirmation and exact-version decision/reason.
- Implementation: apps/web/app/reviews.tsx; API families: portalReviewRead/Preview/Download/FeedbackCreate/Reply/Decision.
- Entry/return paths: Account-selected contact → portal Projects → project Overview/Reviews/Updates; no internal project navigation.
- Existing browser coverage: tests/e2e/phase5.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: Portal-only navigation, retained selected capacity, exact review access revalidation.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.

## P36 — Client Updates

- Route/tier: `/portal/:orgId/updates` with optional `?projectId=:projectId`; Expansion; Phase 7. Features: FR11, FR14.
- Actions/permissions: active client capacity reads an aggregate of permitted published updates and shared review milestones across its accessible portal-enabled projects in the selected organization; optionally filters to one permitted project. Managers publish from P16; project links open this same template with a filter.
- States/dependencies: no accessible projects/updates, filtered empty result, withdrawn update, revoked project/filter; Portal, ClientUpdates, Activity, Access.
- Actual controls: Contact capacity, aggregate/project/date filters, cursors, project and exact review links.
- Implementation: apps/web/app/expansion.tsx; API families: portalUpdatesList.
- Entry/return paths: Account-selected contact → portal Projects → project Overview/Reviews/Updates; no internal project navigation.
- Existing browser coverage: tests/e2e/phase7.spec.ts. Matching tests/phase2–phase7 suites provide live policy, failure, integrity and concurrency evidence; see final report for actual reruns.
- Phase 8 audit/fix: Persisted contact/project/date/cursor selection; one main landmark and correct portal return links.
- New coverage: tests/e2e/phase8.spec.ts covers connected navigation, recoverable filters, multiple organizations, mobile/keyboard basics, session denial, management lifecycle controls, offline upload recovery, folder/version/task linkage and multiple same-organization client capacities/revocation; tests/phase8/integration.test.mjs covers review-filter counts/input/denial. This does not imply every action is repeated in the new suite.
