# Product specification

Status: reconciled product baseline approved by the user's Phase 1 authorization, 2026-10-15. Product defaults are settled; implementation and technical compatibility remain subject to phase validation. The permission details in [SECURITY.md](SECURITY.md) and state rules in [DATA_MODEL.md](DATA_MODEL.md) remain authoritative.

## Mission, boundaries, and scope

DevWorkspace serves independent software agencies and design studios in a shared installation. An organization is a tenant. A client is an agency's customer record, not another tenant. Projects belong to exactly one organization and one client.

| Product area | Owns | Uses through other modules |
| --- | --- | --- |
| LaunchFlow | Clients, projects, milestones, tasks, priority, checklists, task comments/history, assignments, deadlines, delivery progress | Identity, access, files, review feedback-to-task links and outcomes, activity |
| OrbitSpace | Organization/team experience, project access, discussions, documents, notifications, activity | Delivery resources and review events |
| Proofly | Deliverables, immutable versions, review cycles, image/PDF annotations, feedback, formal decisions, client portal | Project access, private files, identity, audit |

There is one identity and tenancy system, one project model, and one file pipeline. These are product areas within one modular monolith. Reports summarize existing delivery/review data; they do not introduce a BI platform.

Included: the 36 templates below, their real actions, accessible minimal interfaces, reliable events, and verification. Excluded unless separately approved: billing/subscriptions, payments, time tracking, CRM sales pipelines, chat/video meetings, e-signatures, social login/SSO/MFA, public review links, anonymous approvals, custom workflow builders, multi-stage approval chains, real-time collaborative document editing, mobile applications, and third-party integrations. Security controls such as email verification are supporting controls within existing authentication templates, not extra page templates.

## Roles and experiences

- **Owner:** internal organization membership; administers the organization and projects, including ownership transfer. The last active owner cannot be removed or demoted.
- **Admin:** internal organization membership; manages team, clients, projects, and settings, except ownership transfer/removal of the last owner.
- **Member:** internal organization membership; accesses only explicitly assigned projects. A project assignment is Manager, Contributor, or Viewer. Managers manage that project's delivery and client grants; Contributors work assigned tasks, upload authorized files/versions, and contribute content; Viewers read internal project content.
- **Client contact:** a user linked to a client record, with explicit per-project Viewer, Reviewer, or Approver access. Viewer reads shared material; Reviewer also adds feedback; Approver also makes a formal decision when named as eligible in the review cycle.

Owner/Admin have organization-wide internal project access. A Member's project Manager role does not confer organization administration. Client affiliation grants no implicit project access. A global user can act in multiple organizations or capacities, but each request uses one verified internal or client principal; rights are never combined across capacities. Client navigation never exposes internal tasks, discussions, documents, team administration, reports, or audit logs.

## Main journeys

1. An agency user registers, verifies email within the authentication flow, creates an organization, and becomes its first Owner atomically. The Owner invites internal teammates; invitation acceptance attaches the verified intended identity without creating duplicate memberships.
2. Owner/Admin creates a client and project, appoints project members, then a Manager creates milestones and tasks with priority, checklists, eligible assignees, and deadlines. Contributors update assigned work/checklist completion and internal users discuss tasks; task history and filters preserve the changes.
3. A Contributor uploads an image/PDF through quarantine and processing, optionally organizing project file listings in a simple logical folder. A clean canonical file becomes an immutable numbered deliverable version. Deliverables always belong to a project and may link to a same-project task. A Manager explicitly shares a selected version and opens a review with named eligible Approvers.
4. A client signs in, enters the dedicated portal, opens an authorized shared version, and places image pins or PDF page annotations. Feedback and replies stay attached to that review and version. Reviewers can ask for changes in feedback; only eligible Approvers can issue the formal `CHANGES_REQUESTED` or `APPROVED` decision.
5. Preparing version N+1 leaves an open review of N unchanged, even if N+1 is separately shared. A Manager deliberately replaces that open cycle with a cycle for a newer ready/shared version using an audited atomic command. Until replacement succeeds, authorized Approvers can decide N exactly as displayed. Earlier bytes, feedback, and decisions remain historical; approval is never inherited. A Manager can also create one internal task from a feedback thread with a durable source link and retry protection.
6. A Manager/Admin revokes a project grant. Subsequent REST requests, preview/download requests, decisions, notification reads, and real-time emissions fail authorization for that principal. Existing downloaded copies cannot be recalled.
7. After core delivery, teams use discussions and basic rich-text documents, Admins inspect audit history, clients read an aggregate of authorized updates across their accessible projects with an optional project filter, and internal users inspect scoped reports. These seven expansion templates must work before redesign.

## Functional requirements and stable IDs

IDs remain stable through implementation and redesign. Page acceptance below adds to these requirements; it does not replace shared security invariants.

| ID | Required behavior | Primary verification |
| --- | --- | --- |
| FR01 | Registration, verified identity, login/logout, recovery, one-time invitations, onboarding, and session revocation | T01, T02 |
| FR02 | Organization lifecycle/settings, internal membership roles, last-owner invariant, principal selection | T02, T03 |
| FR03 | Create/update/archive client records; manage client contacts without granting implicit project access | T03, T04 |
| FR04 | Project lifecycle, explicit internal/client project access, scoped overview and dashboard | T03, T04, T05 |
| FR05 | Milestone CRUD/order/deadlines/progress with same-project task relationships | T05, T06 |
| FR06 | Task priority, checklist items/completion, internal task comment threads/history, assignment, filters/deadlines/status, My Tasks; authorized feedback-to-task creation with durable ancestry and retry protection | T04, T05, T06, T12 |
| FR07 | Private project files in simple logical folders; quarantined uploads, scan/preview, authorized retrieval, failure/retry states; shared processing for separately scoped logo/profile images | T07, T08, T21 |
| FR08 | Project-owned deliverables with optional same-project task link, immutable ordered versions, explicit sharing, exact-version history | T06, T08, T09 |
| FR09 | Named eligible client Approvers, formal exact-version decisions; version preparation independent of deliberate atomic active-review replacement | T09, T10, T11 |
| FR10 | Image/PDF annotations, version-bound feedback/replies/resolution; internal feedback-to-task source link with no client task disclosure | T06, T12 |
| FR11 | Dedicated portal with only explicitly granted projects and shared material | T03, T04, T13 |
| FR12 | Per-recipient in-app notifications, basic user category preferences, and authorized real-time invalidations | T14, T15, T21 |
| FR13 | Internal project discussions and replies, restricted to project access | T16 |
| FR14 | Ordered scoped project activity and an aggregate of authorized client updates with optional project filtering; no internal/inaccessible-project leakage | T17 |
| FR15 | Project-scoped basic rich-text documents: headings, bold, italic, safe links and lists; accessible library, safe structured storage/rendering, optimistic save conflicts | T18 |
| FR16 | Scoped delivery/review analytics with explicit calculation definitions | T19 |
| FR17 | Append-only security/sensitive-action audit recording and authorized audit browsing | T20 |
| FR18 | Own profile/image, password/session and notification preferences; organization logo/description/settings with field-level authority and storage dependencies | T01, T02, T07, T14, T21 |
| FR19 | Tenant/resource isolation, relational integrity, safe repeated/concurrent operations, outbox and recovery | T03, T06, T10, T11, T22, T23 |
| FR20 | All templates operate through real APIs with accessible loading/empty/error/denied/conflict states | T24, T25 |

## Common page contract

`/w/:orgId` is the internal workspace layout; `/portal/:orgId` is the client layout. Project routes contain `:projectId`; detail IDs do not grant access. Account and invitation templates can use the public/auth layout. Organization/capacity selection is an in-layout control, not a new template.

All protected templates require an active session, the chosen active principal, tenant checks, and resource policy. Every applicable page handles loading, empty data, validation errors, server/network failure, expired sessions, and denied/not-found resources. Lists use scoped pagination/filtering; forms prevent duplicate submission but rely on server idempotency/transactions for correctness. The specific states below are additional observable requirements. Minimal HTML forms and ordinary links are sufficient; annotation placement and persistence must be interactive.

Each page entry records route, delivery tier/phase, actions, permissions, states, dependencies, and acceptance. Phase numbers refer to [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). Core = 29 templates; Expansion = seven templates delivered before redesign.

## Public and authentication — 7 templates

### P01 — Landing

- Route/tier: `/`; Core; Phase 2. Features: FR20.
- Actions/permissions: anyone reads an accurate product introduction and follows Register/Login links. No fake customer statistics or demo operations.
- States/dependencies: public content and authenticated navigation; web plus session summary if signed in.
- Acceptance: public navigation reaches real authentication flows; no private data enters the page or public cache.

### P02 — Login

- Route/tier: `/login`; Core; Phase 2. Features: FR01.
- Actions/permissions: authenticate email/password, sign out, follow recovery; signed-in users choose only their valid memberships/client grants.
- States/dependencies: invalid credentials, unverified email with resend, throttled, session expired; Identity and rate limits.
- Acceptance: valid credentials create a revocable cookie session; invalid credentials disclose no account existence; forged redirect targets are rejected.

### P03 — Register

- Route/tier: `/register`; Core; Phase 2. Features: FR01.
- Actions/permissions: create identity and confirm email using an embedded verification state. Registration alone grants no tenant access.
- States/dependencies: validation, generic duplicate response, verification pending/expired/replayed, delivery retry; Identity and local mail adapter/outbox.
- Acceptance: verified user can proceed to onboarding or the intended invitation; unverified identities cannot create organizations or accept privileged access.

### P04 — Forgot Password

- Route/tier: `/forgot-password`; Core; Phase 2. Features: FR01.
- Actions/permissions: anyone requests recovery with a uniform response; rate limits apply.
- States/dependencies: submitted, throttled, generic delivery failure/retry handling; Identity and durable mail dispatch.
- Acceptance: existing/nonexistent accounts receive equivalent public responses; any emitted link is expiring, one-time, and absent from logs.

### P05 — Reset Password

- Route/tier: `/reset-password`; Core; Phase 2. Features: FR01.
- Actions/permissions: holder of valid recovery proof sets a password; identity is derived from that proof, not a supplied user ID.
- States/dependencies: invalid/expired/used token, validation, success; Identity token consumption and session invalidation.
- Acceptance: exactly one concurrent reset succeeds, prior sessions are revoked, and the user returns to login.

### P06 — Accept Invitation

- Route/tier: `/invitations/accept`; Core; Phase 2 internal acceptance, Phase 3 client/grant extension, Phase 5 portal return. Features: FR01, FR02, FR11.
- Actions/permissions: verified intended email accepts an internal or client invitation after authentication; shows organization, capacity, and proposed grants.
- States/dependencies: pending sign-in, email mismatch, expired/revoked/used, success; Identity, Organizations, Clients, Access.
- Acceptance: acceptance is atomic and repeat-safe; token cannot alter role/client/project, cross tenants, or bypass the inviter's current authority.

### P07 — Organization Onboarding

- Route/tier: `/onboarding`; Core; Phase 2. Features: FR01, FR02.
- Actions/permissions: verified signed-in user creates an agency and its first Owner membership; client invitation flow leads to portal instead.
- States/dependencies: incomplete profile, validation, repeated submission, created; Organizations and Identity.
- Acceptance: organization and Owner commit together; repeating the same request cannot create duplicate organizations.

## Agency workspace — 8 templates

### P08 — Dashboard

- Route/tier: `/w/:orgId`; Core; Phase 3. Features: FR04, FR06.
- Actions/permissions: internal users inspect accessible projects, upcoming deadlines, assigned work, and review summaries; links respect project rights.
- States/dependencies: no projects/work, partial read failure; Projects, Tasks, Milestones, later Reviews.
- Acceptance: counts and links use the same access filter; unassigned Members cannot infer private project totals. Review summaries become required in Phase 5.

### P09 — Projects

- Route/tier: `/w/:orgId/projects`; Core; Phase 3. Features: FR04.
- Actions/permissions: internal users list/filter accessible projects; Owner/Admin create, choose client, appoint Managers; Managers update/archive assigned projects.
- States/dependencies: no accessible projects, archived filter, stale update; Projects, Clients, Access.
- Acceptance: project creation validates its tenant/client; an inaccessible project cannot be found through search or pagination.

### P10 — My Tasks

- Route/tier: `/w/:orgId/my-tasks`; Core; Phase 3. Features: FR06.
- Actions/permissions: internal user filters own assigned tasks by status, priority, project and due window, updates permitted work status/checklist completion, and opens Task Details; assignment administration remains Manager-only.
- States/dependencies: none assigned, overdue, incomplete checklist, assignment revoked, stale update; Work, Projects, Access.
- Acceptance: filters reflect persisted priority/deadline/status; tasks disappear when assignment/access ends; crafted IDs cannot change another user's assigned checklist/work state without management authority.

### P11 — Clients

- Route/tier: `/w/:orgId/clients`; Core; Phase 3. Features: FR03.
- Actions/permissions: Owner/Admin create/manage/archive clients; Members read only limited client summaries associated with accessible projects.
- States/dependencies: empty, archived, cannot archive with active projects; Clients and Projects.
- Acceptance: filtered members cannot list other client records/contact details; archive preserves history and blocks new active projects for that client.

### P12 — Client Details

- Route/tier: `/w/:orgId/clients/:clientId`; Core; Phase 3. Features: FR03, FR04, FR11.
- Actions/permissions: Owner/Admin edit client/contact identities and invitations; project Managers may read contacts for their client's assigned projects and manage grants on P23. Others see only permitted summary/projects.
- States/dependencies: no contacts/projects, pending invite, archived; Clients, Invitations, Access.
- Acceptance: client contact creation does not expose projects; project/contact responses honor field-level policy and tenant ancestry.

### P13 — Team Management

- Route/tier: `/w/:orgId/team`; Core; Phase 2. Features: FR01, FR02.
- Actions/permissions: Owner/Admin list internal team, invite, change roles, revoke invitations, deactivate memberships; Owner controls ownership.
- States/dependencies: pending/revoked/expired invite, last-owner conflict, deactivated member; Organizations, Identity, Audit.
- Acceptance: concurrent demotions cannot remove the last Owner; deactivation prevents further project actions even with an existing session.

### P14 — Notifications

- Route/tier: `/w/:orgId/notifications`; Core; Phase 6. Features: FR12.
- Actions/permissions: internal recipients list own notifications, mark read, open still-authorized resources. Clients receive permitted badges/notifications within the portal layout, reusing this component without another template.
- States/dependencies: empty, unread/read, revoked target, delayed delivery; Notifications, Outbox, Realtime, Access.
- Acceptance: another user's notification ID cannot be read/changed; revoked resource text and links are suppressed, including stale stored notifications.

### P15 — Reports & Analytics

- Route/tier: `/w/:orgId/reports`; Expansion; Phase 7. Features: FR16.
- Actions/permissions: internal users filter permitted delivery/review summaries by project/date; Owner/Admin see tenant totals, Members only accessible projects.
- States/dependencies: insufficient/no data, invalid date window; Reporting read services over Projects/Tasks/Reviews.
- Acceptance: displayed figures reconcile to scoped source records and documented formulas; no cross-project leakage through totals or filters.

## Project workspace — 9 templates

### P16 — Project Overview

- Route/tier: `/w/:orgId/projects/:projectId`; Core; Phase 3. Features: FR04, FR05, FR06, FR09.
- Actions/permissions: authorized internal users inspect project, client, milestones, work progress, and version-specific review summaries; Managers update lifecycle metadata.
- States/dependencies: planned/active/completed/archived, no tasks, stale update; Projects, Milestones, Tasks, later Reviews.
- Acceptance: project completion is explicit and validated; task progress does not silently imply client approval. Review summaries are integrated in Phase 5.

### P17 — Task Board

- Route/tier: `/w/:orgId/projects/:projectId/tasks`; Core; Phase 3. Features: FR06.
- Actions/permissions: Managers create/assign/reorder tasks and set priority/deadlines/status; Contributors change own assigned work state; Viewers read. Filter by status, assignee, priority and due window; a select/button workflow suffices.
- States/dependencies: empty column/filter, blocked/overdue task, stale revision; Work, Access.
- Acceptance: priority/status/assignment/deadline filters and updates survive reload; nonmembers/cross-project assignees and overposted management fields are rejected; history records changes.

### P18 — Task Details

- Route/tier: `/w/:orgId/projects/:projectId/tasks/:taskId`; Core; Phase 3, review origin in Phase 5. Features: FR05, FR06, FR08, FR10.
- Actions/permissions: internal users read task/checklist/comments/history. Managers edit metadata, priority, milestone, assignee/deadline and checklist structure; assigned Contributors change work state and check/uncheck items. Managers/Contributors add internal task threads/replies. Show authorized deliverable links and, when present, the source feedback link.
- States/dependencies: unassigned, overdue, empty/incomplete checklist, no comments/history, stale update, archived/completed project; Work, Milestones, Access; Files/Deliverables in Phase 4 and Reviews in Phase 5.
- Acceptance: same-project ancestry and current assignment are enforced on every checklist/comment/history endpoint; checklist completion does not automatically finish a task; concurrent changes conflict safely. Source feedback remains linked, and clients cannot discover internal task content or links.

### P19 — Milestones

- Route/tier: `/w/:orgId/projects/:projectId/milestones`; Core; Phase 3. Features: FR05.
- Actions/permissions: internal project users read; Managers create, edit, order, and explicitly complete milestones.
- States/dependencies: empty, open, completed, overdue, incomplete-task conflict; Milestones and Tasks.
- Acceptance: completion requires all noncancelled linked tasks done; adding/reopening work atomically reopens the milestone with activity evidence.

### P20 — Project Discussions

- Route/tier: `/w/:orgId/projects/:projectId/discussions`; Expansion; Phase 7. Features: FR13.
- Actions/permissions: internal Managers/Contributors create topics and replies; Viewers read; Managers archive topics.
- States/dependencies: empty, open/archived topic, validation; Collaboration, Access, Activity.
- Acceptance: persisted replies paginate correctly; clients cannot fetch or subscribe to internal discussions, including through attachments/events.

### P21 — Project Files

- Route/tier: `/w/:orgId/projects/:projectId/files`; Core; Phase 4. Features: FR07.
- Actions/permissions: internal users browse/filter root or one logical folder and download clean files; Managers/Contributors upload into an existing same-project folder or root; Managers create/rename folders, move file listings and remove empty folders.
- States/dependencies: empty root/folder, duplicate folder name, nonempty-folder deletion conflict, uploading/quarantined/scanning/ready/rejected/failed/expired; Files, Storage, Worker, Access.
- Acceptance: folders are one flat level with inherited project permissions; moves affect listing metadata only, preserve bytes/version links, and reject other-project folders. Removing a nonempty folder cannot cascade-delete files; unsafe bytes remain unavailable.

### P22 — Deliverables

- Route/tier: `/w/:orgId/projects/:projectId/deliverables`; Core; Phase 4, review controls in Phase 5. Features: FR08, FR09.
- Actions/permissions: internal users read version history; Managers/Contributors create project-owned deliverables with optional same-project task link and prepare immutable versions; Managers manage task links, share/revoke versions, open/cancel reviews, or explicitly replace an open review with a newer ready/shared version.
- States/dependencies: no versions, unlinked task, processing, internal/shared, latest prepared version distinct from active review target, terminal review, replacement conflict; Deliverables, Files, Work, Reviews, Access.
- Acceptance: version numbers are unique and old bytes immutable. Creating/sharing N+1 leaves N's open review intact; replacement is deliberate/atomic/audited and approvals stay exact-version. Linking/unlinking a task never changes project/tenant or historical review targets.

### P23 — Project Team & Access

- Route/tier: `/w/:orgId/projects/:projectId/access`; Core; Phase 3, client review rules in Phase 5. Features: FR04, FR11.
- Actions/permissions: internal project users see a permitted roster; Managers manage same-tenant internal assignments and same-client contact grants; only Owner/Admin invite/change organization membership.
- States/dependencies: no contacts, pending invite, revoked grant, approver affected by open review; Access, Organizations, Clients, Reviews.
- Acceptance: client grants never target another client's project; revocation immediately blocks future review authority and does not rewrite past decisions.

### P24 — Project Activity

- Route/tier: `/w/:orgId/projects/:projectId/activity`; Expansion; Phase 7. Features: FR14.
- Actions/permissions: authorized internal project users browse paginated/filterable lifecycle events.
- States/dependencies: no events, delayed projection, archived project; Activity, Outbox, Access.
- Acceptance: successful durable mutations appear once logically despite retries; audit/security secrets and client-only private payloads are excluded.

## Reviews and documents — 4 templates

### P25 — Review Center

- Route/tier: `/w/:orgId/reviews`; Core; Phase 5. Features: FR09.
- Actions/permissions: internal users list/filter accessible review cycles by status/deadline/exact version; Managers open a cycle on an explicitly selected eligible shared version, or use the replacement action when a cycle is already open.
- States/dependencies: empty, open, approved, changes requested, cancelled, superseded; latest prepared version may differ from active review; Reviews, Deliverables, Access.
- Acceptance: counts/outcomes identify each cycle's actual target; preparing or sharing another version never silently changes that target or disables a valid approval.

### P26 — Review Workspace

- Route/tier: `/w/:orgId/projects/:projectId/reviews/:reviewId`; Core; Phase 5. Features: FR06, FR09, FR10.
- Actions/permissions: internal users inspect exact bytes/annotations/history; Managers/Contributors add permitted feedback/resolution events. Managers cancel or explicitly replace an open review and create an internal task from a readable feedback thread, selecting valid task fields/assignment. Internal roles never grant client decision authority.
- States/dependencies: preview unavailable, open/read-only terminal cycle, replacement conflict, task already created, invalid assignee, inactive project; Reviews, Feedback, Work, Files, Access.
- Acceptance: annotations persist; create-task atomically stores a same-project source link/history/event and at most one task per thread, including retries with different keys. Conversion may use closed-cycle feedback in an active project, does not resolve/approve it, and never exposes task IDs/backlinks to clients.

### P27 — Documents Library

- Route/tier: `/w/:orgId/documents`; Expansion; Phase 7. Features: FR15.
- Actions/permissions: internal users browse/search documents from accessible projects; Managers/Contributors create a document in an authorized active project.
- States/dependencies: empty, archived document/project, forbidden destination; Documents and Access.
- Acceptance: library search and counts include only accessible project documents; clients cannot retrieve document bodies or search snippets.

### P28 — Document Editor

- Route/tier: `/w/:orgId/projects/:projectId/documents/:documentId`; Expansion; Phase 7. Features: FR15.
- Actions/permissions: Managers/Contributors author formatted text using a minimal working toolbar/editor for headings, bold, italic, links, bulleted and numbered lists; Viewers read; Managers archive. A plain textarea alone does not satisfy this scope.
- States/dependencies: unsaved/saving/saved, invalid link/content, unsupported pasted formatting, revision conflict, read-only; Documents, Access, Activity.
- Acceptance: each supported format survives save/reload/render; a bounded allowlisted structured document is validated server-side and safely rendered, with unsafe HTML/styles/embeds/scripts stripped or rejected. Concurrent saves preserve unsaved input and offer conflict recovery; no collaborative editing engine is required.

## Settings and account — 3 templates

### P29 — Organization Settings

- Route/tier: `/w/:orgId/settings`; Core; Phase 2 text/settings, Phase 4 logo. Features: FR02, FR07, FR18.
- Actions/permissions: Owner/Admin edit agency name, plain-text description and display timezone; upload/replace/remove a logo once the real image pipeline exists. Owner transfers ownership to a verified active internal member with recent authentication.
- States/dependencies: validation, saved/stale settings, reauthentication, image processing/rejected/ready; Organizations, Identity, Audit; Files/Worker in Phase 4.
- Acceptance: client/Member writes are denied; logo attachment requires a clean PNG/JPEG asset owned by the same organization, not a project-file ID or arbitrary URL; replacement preserves the previous image until the new one is ready. Description renders safely and ownership transfer remains atomic.

### P30 — Audit Log

- Route/tier: `/w/:orgId/audit`; Expansion; Phase 7. Features: FR17.
- Actions/permissions: Owner/Admin browse and filter tenant audit metadata; no UI or API edits/deletes.
- States/dependencies: empty, date/action/actor filters, pagination; Audit and Access.
- Acceptance: records for role/access/share/decision/security actions exist from the phases that introduced those actions, even before this browser template is built.

### P31 — My Account

- Route/tier: `/account`; Core; Phase 2 account, Phase 4 profile image, Phase 6 notification preferences with Phase 7 category extensions. Features: FR01, FR07, FR12, FR18.
- Actions/permissions: authenticated user edits own display name; uploads/replaces/removes own profile image; changes password with recent proof; manages own sessions and basic in-app notification category preferences. Portal reuses this template.
- States/dependencies: validation/conflict/reauthentication/revoked session, image processing/rejection, saved notification preferences; Identity, Files/Worker, Communications.
- Acceptance: another user's ID/assets/preferences cannot be used. Images are clean owner-scoped PNG/JPEG assets and initially visible only to that account owner. Optional in-app notification preferences affect future delivery, preserve existing notifications, and cannot suppress verification/recovery/invitation messages. Controls arrive with their working Phase 4/6 dependencies.

## Client portal — 5 templates

### P32 — My Projects

- Route/tier: `/portal/:orgId/projects`; Core; Phase 5. Features: FR11.
- Actions/permissions: active client contacts list explicitly granted, portal-enabled projects and open them.
- States/dependencies: no grants, portal disabled, grant revoked; Portal, Projects, Access.
- Acceptance: same-client affiliation or another contact's grant cannot expose a project; tenant/capacity switching clears previous private UI data.

### P33 — Client Project Overview

- Route/tier: `/portal/:orgId/projects/:projectId`; Core; Phase 5. Features: FR11, FR05.
- Actions/permissions: granted client contacts read curated project status and milestone summaries, then navigate shared deliverables/reviews.
- States/dependencies: no shared material, active/completed/archived, disabled portal; Portal, Projects, Milestones, Reviews.
- Acceptance: responses contain no internal task descriptions, discussions, documents, member emails, or unshared version metadata.

### P34 — Client Deliverables

- Route/tier: `/portal/:orgId/projects/:projectId/deliverables`; Core; Phase 5. Features: FR08, FR11.
- Actions/permissions: granted contacts list active explicitly shared versions, retrieve allowed files, and inspect exact-version reviews/decisions; distinguish the version currently under review from other shared versions.
- States/dependencies: nothing shared, share revoked, historical approval, newer shared version without a review; Portal, Deliverables, Files, Reviews.
- Acceptance: unshared version metadata is absent; sharing N+1 does not imply that its review has started or that N's review ended. Badges identify exact version numbers and never imply approval transfer.

### P35 — Client Review Workspace

- Route/tier: `/portal/:orgId/projects/:projectId/reviews/:reviewId`; Core; Phase 5. Features: FR09, FR10, FR11.
- Actions/permissions: Viewers read client-visible content; Reviewers/Approvers annotate/reply while open; named currently eligible Approvers confirm the displayed cycle/version/digest before approve/request changes.
- States/dependencies: no authority, open, terminal/read-only, explicitly superseded, revoked, competing decision/replacement; Portal, Reviews, Feedback, Files.
- Acceptance: N remains decidable while N+1 is merely prepared/shared; an explicit replacement makes the old cycle read-only. Stale windows cannot approve a replacement version implicitly. No internal task IDs, conversion markers, comments or backlinks appear in client feedback responses.

### P36 — Client Updates

- Route/tier: `/portal/:orgId/updates` with optional `?projectId=:projectId`; Expansion; Phase 7. Features: FR11, FR14.
- Actions/permissions: active client capacity reads an aggregate of permitted published updates and shared review milestones across its accessible portal-enabled projects in the selected organization; optionally filters to one permitted project. Managers publish from P16; project links open this same template with a filter.
- States/dependencies: no accessible projects/updates, filtered empty result, withdrawn update, revoked project/filter; Portal, ClientUpdates, Activity, Access.
- Acceptance: authorize each source before aggregation/pagination/counts; filter options and totals expose no inaccessible project information. A forged/revoked project filter returns safe not-found/denied, never a broader feed. Internal activity stays private; no additional page template is added.

## Product rules requiring explicit review

The architecture direction is provisionally accepted. The following reconciled product defaults are approved for implementation planning by the Phase 1 authorization:

1. **Approval policy retained:** any one named, currently eligible client Approver may make the sole formal decision on an open cycle. No voting, quorum, internal override or approval transfer.
2. **Prepare, share, review:** every created version is immutable. `latest_version_id` means most recently prepared bytes only. Creating or separately sharing N+1 does not affect N's open review. A cycle's fixed `version_id`, current authority and share determine eligibility; being the latest prepared version is not required.
3. **Deliberate replacement:** only a Manager/Owner/Admin may replace an OPEN cycle with a new OPEN cycle for a newer ready, available, already shared, never-approved version of the same deliverable. The explicit command includes old cycle/revision and target version/digest/roster. Superseding the old cycle, opening the new one, audit and outbox commit together. If a decision wins first, replacement conflicts and requires a refreshed, deliberate new-cycle action; it must not silently replace a terminal cycle. If replacement wins, the old decision fails. Mere preparation and approval may both succeed.
4. **History and reopening:** terminal cycles never reopen or change targets. When there is no open cycle, a Manager explicitly selects any eligible shared version that has never been approved for a new cycle, preserving prior cycles; a newer prepared version does not invalidate that selection. Already approved versions cannot be reviewed again; create a new version. Historical shares remain readable until separately revoked. Feedback resolution/task conversion never counts as approval.
5. **Eligibility and lifecycle:** opening/replacing requires an active project, enabled portal, available clean version, active share, and at least one named active Approver. Grant revocation removes future authority without rewriting decisions. Project completion requires no unfinished noncancelled tasks and no OPEN reviews; it does not infer approvals. Archive cancels open cycles and blocks ordinary content writes. Existing authorized history remains readable subject to current access.
6. **Task behavior:** priority is LOW/NORMAL/HIGH/URGENT, default NORMAL. Keep one optional primary assignee with active internal membership and an active Manager/Contributor project assignment, a nullable milestone, filters, deadlines/status and durable task history. Removing/downgrading that assignment clears or reassigns active tasks atomically. Managers administer priority/assignment/checklist structure; assigned Contributors check/uncheck items and update permitted work status. Managers/Contributors can post internal task threads/replies; Viewers read. Checklist completion is independent of task status and does not automatically complete or block a task.
7. **Feedback-to-task:** use the existing Manager/O/A task-create permission, validate source/target project and assignment, and create one task per source thread with an immutable source reference. A permanent unique constraint plus scoped idempotency prevents duplicate conversion, including different retry keys; a different-key repeat returns 409 Conflict, with the existing-task reference only after current visibility authorization; it never changes the task. A closed cycle is a valid source if readable and its project is active. Client representations/events omit all internal task/conversion information.
8. **Relationships and files:** a Deliverable must belong to one Project and may optionally link to one task in that same tenant/project. Creating an unlinked deliverable is supported; link/unlink actions do not reparent it or alter review history. Project file folders are a flat logical grouping with inherited project permissions, no nesting or folder ACLs. Folder moves never rename/copy underlying objects; only empty folders can be removed.
9. **Documents and collaboration:** documents support headings, bold, italic, safe links and ordered/unordered lists through a simple visual editor. Store a bounded allowlisted structured document; safely render it without arbitrary HTML/styles/embeds. Discussions, task comments/history and documents are internal. Review visibility is fixed per thread; publishing internal feedback requires a new client-visible thread. No collaborative document editing engine.
10. **Settings and preferences:** organization description is plain text; organization logo and own profile image use the existing safe storage/processing pipeline with distinct ownership scopes. Initial profile image visibility is self-only; organization branding is available to active members and contacts with an accessible portal project. Optional in-app categories are assignments, review activity, discussions/documents and client updates, default enabled; disabling affects future notifications only. Security/verification/recovery/invitation messages are mandatory and outside those preferences. No marketing/email notification channel is added.
11. **Metrics and dates:** task progress = DONE noncancelled tasks / all noncancelled tasks; zero eligible tasks displays “no tasks.” Checklist completion is shown separately. Overdue excludes done/cancelled work. Review turnaround uses terminal decision time minus open time, excluding cancelled/superseded cycles. Counts name exact approved versions. Store UTC instants and display in user/organization timezone; reports distinguish live state from time-window events.
12. **Limits and remaining review choices:** proposed project uploads remain PNG/JPEG/PDF, at most 25 MiB and 100 PDF pages; logo/profile uploads use PNG/JPEG only, initially at most 2 MiB and a bounded pixel count validated in V05. The approval/replacement rules, optional task relationship, one-primary-assignee/one-conversion-task defaults, profile visibility and limits are accepted product defaults; validate technical limits at their existing gates. Session timeouts, retention/grace periods and local resource budgets remain the existing V01/V05/V08 validation decisions. No new major product feature is implied.

## Coverage control

| Area | Core | Expansion | Total |
| --- | ---: | ---: | ---: |
| Public & Authentication | 7 | 0 | 7 |
| Agency Workspace | 7 | 1 | 8 |
| Project Workspace | 7 | 2 | 9 |
| Reviews & Documents | 2 | 2 | 4 |
| Settings & Account | 2 | 1 | 3 |
| Client Portal | 4 | 1 | 5 |
| **Total** | **29** | **7** | **36** |

Expansion IDs are exactly P15, P20, P24, P27, P28, P30, P36. Page IDs, FR IDs, permissions, phase ownership, and verification cases must be maintained together through the traceability process in [TESTING.md](TESTING.md). No page is functionally complete because a route merely renders.


### Feedback-to-task duplicate contract

For the same authorized actor/scope, the same idempotency key and matching payload replay the original result after authorization. A reused key with a different payload returns 409 Conflict. The same source thread with a different key returns 409 Conflict; include an existing-task reference only if that actor is still authorized to see that task. Client principals never receive internal task references. Permanent source uniqueness and transaction/concurrency protection remain mandatory. This is a Phase 5 contract, not Phase 1 application functionality.
