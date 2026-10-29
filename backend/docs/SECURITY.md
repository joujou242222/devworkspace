# Security model

## Phase 7 expansion boundary

Expansion reuses live session/principal checks and organization serialization. Manager/Contributor authorship, Viewer read-only, Manager archive/publication and O/A audit browsing are domain policies. Every descendant repeats tenant/project ancestry. Client aggregates require current contact, explicit grant, client/portal and exact shared/available review source before counts/options/pages; denied filters never fall back to all projects. Internal discussion/document/conversion content is excluded from client representations.

Strict schemas reject unknown fields, HTML/styles/embeds, excessive structure and unsafe links. Explicit React rendering escapes text; paste becomes text. Mutations commit audit/outbox/receipts atomically and CAS/lifecycle rejects stale/archive races. New categories reuse permission-before-preference materialization, recipient RLS and per-emission socket checks. Only the NONLOGIN communications purpose receives name-only identity reads for internal activity; login worker/API roles gain no general identity read. Audit DTOs exclude arbitrary metadata/content. See [Phase 7 report](PHASE_7_REPORT.md) for runtime evidence and V08 limits.

## Phase 4 implementation, 2026-10-17

The authorized Phase 4 implementation adds private staging, exact-version canonical reads and real scanning/rendering. See [Phase 4 evidence](PHASE_4_REPORT.md); the prior phase records below are historical. Every metadata/content request revalidates session, selected principal, tenant, project ancestry, role, visibility and availability. Client affiliation/grants do not grant internal file access. Viewer cannot upload; Contributor cannot manage folders/listings. Logo mutation requires Owner/Admin; profile mutation is self-scoped. Quarantine is never downloadable.

Signed PUTs bind five-minute expiration, opaque staging key, exact length/MIME/SHA-256 and conditional creation. The same-origin proxy permits only staging PUTs with the expected Origin and strips cookies. Canonical reads pass through authorized APIs using stored S3 version IDs. API, processor and cleanup have separate bucket-scoped credentials; no administrator environment fallback exists. Raw filer/volume access requires JWTs; local readiness uses short-lived authenticated requests without emitting secrets. Deletion/version deletion of canonical objects is denied to runtime identities.

Untrusted bytes are decoded/scanned only by actual zero-network-capability AppContainer processes with no inherited handles or credentials. Tools/CVDs are verified and read/execute only; writable work is dedicated and project-local. Default Windows package profile writes are explicitly denied. Token, network and filesystem negative tests, limits and rollback are documented in the [native runbook](../infra/README.md). Setup/rollback require an exclusive lifecycle lock; active launches retain shared locks. No firewall, loopback exemption, Windows service, global PATH, Docker, WSL or upgrade is introduced.

ClamAV freshness/unavailability, warning/skip or renderer failure prevents READY. Hash/size and bounded output are independently checked by the trusted parent; dangerous PDF actions/attachments/XFA and excessive geometry/page counts fail closed. Version/asset/processing facts are append-only. Sensitive mutations and finalization audit/outbox commit together. Exact-key cleanup holds authoritative upload locks and excludes all active/reference-bearing content. Broader V08 recovery and Phase 5 annotations/reviews remain unverified in this phase.

Current execution, 2026-10-16: Phase 2 implements Identity/Organizations/Access, forced tenant RLS, restricted roles, sensitive-action audit, transactional outbox and durable native mail. See [Phase 2 verification](PHASE_2_REPORT.md). This supersedes earlier Phase 1 statements about those controls being unimplemented. File/review/notification/socket controls remain at later gates; product mode exposes no Socket.IO authority or client invitation placeholders.

Status: required design and verification plan, not a security certification. Authentication library/version selection, pooled RLS behavior, storage guarantees, and real-time revocation are pending the architecture validation gates. Security requirements apply from each feature's first implementation, even when its management page arrives later.

## Trust boundaries and principal model

The browser, route parameters, cookies before validation, request bodies, uploads, object metadata, queued payloads, and socket messages are untrusted. Redis and object storage are not authorization authorities. UUIDs and hidden UI controls provide no access control.

Each authorized action has a validated global user, one selected organization, one acting capacity, a resource ancestry chain, an action, and current state. Internal capacity resolves through active OrganizationMembership; client capacity resolves through active ClientContact and explicit active ClientProjectAccess. A client contact's employer/client association is not a project grant. Rights from another capacity, organization, project, or invitation are never combined.

The worker uses a named system purpose and event identity, not a fabricated Admin identity. It may process an already-authorized asset, but cannot invent a version share, approval, membership, or tenant context from untrusted job fields.

## Authentication and session lifecycle

The candidate is Better Auth hosted in NestJS Express with PostgreSQL-backed opaque sessions, behind an Identity boundary. See [the evaluation and official sources](ARCHITECTURE.md#authentication-evaluation-and-provisional-recommendation). Requested V01 compatibility now passes in the isolated experiment with the policy/receipt adaptations documented below. Production persistence, abuse controls and lifecycle implementation still require Phase 2 review. The fallback remains reviewed NestJS/Passport/Express sessions with a durable PostgreSQL store; no memory-only production store or second Next.js auth authority.

Required behaviors, regardless of chosen library:

- Email/password registration and verified identity. Use the library's supported vetted password hashing with reviewed algorithm/cost; do not write cryptographic primitives. Verify local recovery, email-verification storage, reset revocation, and constant-time proof comparison where applicable.
- Cookies are HttpOnly, Secure, host-only (no Domain), Path `/`, SameSite=Lax, with a `__Host-` name under HTTPS. Use `https://localhost:8443` consistently, including security E2E. Session identity is opaque and contains no trusted tenant roles. The Phase 1 experiment now verifies these attributes with project-local TLS and scoped browser trust; no OS trust change occurred.
- Rotate session identity at login/reauthentication and sensitive privilege transitions; revoke the old session. Logout destroys/revokes it server-side and clears the cookie. Password reset revokes all sessions; password change requires recent proof and revokes others. Account deactivation blocks all access.
- Required limits: absolute session lifetime 8 hours, idle timeout 30 minutes, recent authentication within 10 minutes for password/ownership changes. These limits pass the isolated Phase 1 policy/probe tests; production password/ownership operations are not implemented. Server time governs expiry.
- Read live session revocation/identity security revision on protected access; disable stale cookie-session caching as an authorization shortcut. Cache absence/presence checks may guide navigation only. Server-rendered pages and API actions perform authoritative checks.
- Recovery/verification/invitation proofs are unpredictable, purpose-bound, expiring, and one-time. Proposed expiry: recovery 30 minutes, verification 24 hours, invitation 7 days. Persist proof digests where supported; if the auth library requires another representation, review its exposure controls before adoption. Do not log URLs/tokens or put them in analytics/referrers; remove token query state after consumption.
- Invitation acceptance requires the verified intended email and current invitation state. Recheck inviter/organization authority and proposed target grants; reject an invitation after revocation, tenant/client mismatch, or inviter authority loss. Accept atomically with membership/contact/grant creation and audit. Concurrent/repeated acceptance cannot mint extra rights.
- Rate-limit login, recovery, verification resend, invitation acceptance, uploads, and decisions by safe combinations of IP/identity/tenant; use uniform responses for account enumeration paths. Avoid permanent account lockouts that enable trivial denial of service. Local mail catcher is the development transport; links are real one-time flows, not stubbed success.

### CSRF, origin, and same-origin topology

All unsafe browser API methods, including login/logout and auth-library routes, enforce approved Origin and session-bound CSRF proof where applicable. Use a synchronizer token or the library's demonstrably equivalent defense; SameSite cookies alone are insufficient. Define a safe token acquisition endpoint bound to the session/login flow. Reject missing/untrusted origins in browser cookie flows, except an explicitly defined nonbrowser trusted path with equivalent protections. No state-changing GETs.

The concrete local proxy exposes only `https://localhost:8443`: web, `/api/v1/*`, the selected `/api/auth/*` mount, Socket.IO, and a staging-only signed PUT route `/dw-staging/<opaque-key>`. S3 itself has no published host port. Preserve external signed Host/port/path/query/headers unchanged to private `s3:9000`; never strip a prefix or rewrite a presigned internal URL. Reject storage listing/read/delete/admin methods and foreign/missing Origin. Browser PUT omits credentials and the proxy strips cookies; it authenticates with the scoped signature, while issuing/finalizing the intent uses ordinary session/resource/CSRF checks. Same-origin upload needs no cross-origin CORS allowance; CORS remains closed, with no wildcard or second public origin. Origin alone is not authentication. Trust forwarded headers only from the configured proxy; enforce body caps and safe redirect rules. Use CSP/frame/nosniff/referrer protections and TLS.

Next.js forwards user credentials only to the configured API host and never makes tenant decisions from unchecked headers/cookies. Protected fetches and rendered private pages use no shared cache/static output; invalidate query state on logout, organization switch, or capacity change. Prevent browser-safe packages/environment variables from exporting server secrets.

## Permission evaluation

For every REST read/mutation, file/preview request, notification read, socket subscription/emission, and worker handler:

1. Authenticate the user/session or allowlisted system purpose. Reject inactive/expired identity. An explicitly public endpoint has its own narrow policy.
2. For tenant resources, resolve organization/capacity and enter the tenant unit of work before access. Route org ID selects context to validate, not membership. Global own-account/profile/preference operations instead use the narrow self-owned identity boundary, without a fabricated tenant.
3. Load the resource through tenant-qualified ancestry and apply current membership/contact/grant policy. Return indistinguishable not-found responses for inaccessible resource identity.
4. Evaluate action permission, field allowlist, visibility, lifecycle state, and version/review eligibility. Reject supplied ownership/role/tenant fields that the command does not permit.
5. For sensitive mutations, recheck relevant authority under the same serialization locks used by concurrent revocation/state changes. Record actor capacity, safe audit metadata, and durable event intent in the transaction.
6. Serialize only the permitted DTO fields. Apply the same predicate before list pagination, search snippets, counts, reports, filenames, download headers, and errors.

Use one shared policy service in the server domain. Guards establish authentication/context, while application services enforce resource policies; an endpoint-level role decorator alone is insufficient. No global “super admin” bypass is part of product scope.

### Action matrix

Every “yes” below still requires the correct tenant/project, active state, and permitted fields. Owner/Admin are abbreviated O/A. Project roles apply only to internal Members explicitly assigned that project. Client roles are per project; Approver includes Reviewer abilities, Reviewer includes Viewer abilities.

| Action | O/A | Project Manager | Contributor | Viewer | Client Viewer / Reviewer / Approver |
| --- | --- | --- | --- | --- | --- |
| Manage organization, team invitations/roles | Yes; ownership Owner-only | No | No | No | No |
| View audit browser / all tenant clients | Yes | No global access | No global access | No global access | No |
| Create/edit/archive client; create/link client contacts | Yes | Read needed contact fields for assigned client's project only | Limited client summary | Limited client summary | No |
| Create project / select its client | Yes | No organization-wide creation authority | No | No | No |
| Read internal project / scoped dashboard, reports, activity | Yes, organization-wide | Assigned project | Assigned project | Assigned project | No internal view |
| Edit project, milestones, task priority/assignment/deadlines and checklist structure | Yes | Yes | No | No | No |
| Change task work state / toggle checklist completion | Yes | Yes | Own currently assigned task only | No | No |
| Read task comments/history; post task thread/reply | Read/post | Read/post | Read/post on accessible project tasks | Read only | No |
| Create task from review feedback | Yes | Yes, same active project | No | No | No; no task IDs/conversion markers disclosed |
| Assign internal project roles / client grants | Yes | Yes, existing eligible same-tenant members/same-client contacts | No | No | No |
| Upload project files / create deliverables or versions | Yes | Yes | Yes, authorized active project | No | No |
| Read/download internal clean files/versions | Yes | Yes | Yes | Yes | Shared versions only, with active grant/share/portal |
| Manage flat folders / move file listings | Yes | Yes | Choose existing same-project folder on upload only | Read only | No |
| Edit organization description/logo | Yes | No | No | No | Read branding only with an accessible portal project |
| Manage own profile image / notification preferences | Own only | Own only | Own only | Own only | Own only via account boundary |
| Enable portal, share/revoke version, open/cancel/explicitly replace review | Yes | Yes | No | No | No |
| Read/add internal review threads | Yes | Yes | Yes | Read | No |
| Read client-visible review threads | Yes | Yes | Yes | Yes | All granted client roles |
| Add client-visible feedback/annotation while review open | Yes | Yes | Yes | No | Reviewer/Approver only |
| Append internal feedback resolution events | Yes | Yes | Yes | No | No |
| Formal APPROVED / CHANGES_REQUESTED decision | No internal authority | No internal authority | No | No | Named currently eligible Approver only |
| Create/edit discussions and documents | Yes | Yes | Yes | Read only | No |
| Publish/withdraw client updates | Yes | Yes | No | No | Read published updates only |
| Read/mark notification; manage profile/sessions | Own capacity/account only | Own only | Own only | Own only | Own only |

Only an Owner can transfer ownership; an Admin cannot demote an Owner or promote a new Owner. Organizational membership changes serialize on the Organization row. Project Managers cannot grant organization roles or create other client identities; they can grant existing same-client contacts access to their own projects. Internal invitation/grant creation checks the issuer's current authority, including during acceptance.

Grant revocation removes future authority and clears/reassigns active tasks on internal project removal or downgrade to Viewer. Assignees require active internal membership and an active Manager/Contributor project role; checklist/comment writes recheck the current assignment/role. Preserve append-only task history and feedback-source references. Identity deactivation leaves history but denies work. Actor snapshots are evidence, not permissions; acting as a client never borrows internal authority.

## Version-specific review authority

- Shared version + active project client grant + enabled portal + clean available file + fixed cycle target are all required. The target need not equal `latest_version_id`; preparing or sharing N+1 leaves N's open review valid.
- Opening freezes exact version/digest, ANY_ONE policy and named Approver roster. At least one active eligible Approver is required. New grants/promotions do not automatically modify that roster. The decision point rechecks current contact/grant and session, never trusts the snapshot alone.
- Decisions require displayed cycle/version/digest, expected revision and scoped idempotency, with deliberate UI confirmation. Reading a new version or creating a task from its feedback confers no approval authority. Internal Admins/Managers cannot decide as clients.
- Only Manager/O/A with ordinary review-management authority may explicitly replace an OPEN cycle. Validate its expected ID/revision and a newer ready/available/already shared, never-approved version of the same deliverable plus new eligible roster. Supersession/new cycle/audit/outbox commit together; the command never edits a cycle target.
- Decision versus replacement/revocation serializes on Project/access/Deliverable/Review locks. If decision wins, replacement conflicts; if replacement wins, the old decision conflicts. Preparation/independent sharing and an old-cycle decision may both succeed. A stale window must never submit to “latest” or silently switch targets.
- Same-cycle decisions have one immutable winner. Mandatory keys and unique replacement/source constraints prevent repeated commands creating extra facts; reauthorize before replay. Prior approvals remain version-specific history, including after access loss or newer version preparation. Existing shares stay active until separately revoked.
- Terminal cycles remain terminal; with no OPEN cycle, a Manager can explicitly open a new cycle on any otherwise eligible never-approved shared version. Only an explicit replacement marks an existing OPEN cycle SUPERSEDED; share/portal revoke or archive cancels it instead. Approved versions cannot reopen.
- A transaction authorized before a serialized revocation may finish; one authorized afterward must fail. Downloaded bytes or already-sent packets cannot be recalled. Security blocking a file denies retrieval without rewriting version/approval facts.

## Restored feature policies

- Task priority, assignment, metadata and checklist structure require task-management authority. Current assigned Contributors may toggle checklist items/change permitted work state; other Contributors may only read and post internal task comments. Every nested item/thread/reply/history request validates tenant/project/task ancestry. Append history atomically; comments/checklist state never implicitly alter approval or task DONE status.
- Feedback conversion uses Manager/O/A task-create authority and readable feedback in the same active project, including terminal cycles. Validate proposed assignee/milestone. Insert Task + immutable source-thread FK + history/audit/outbox/receipt atomically. The permanent unique source-thread key prevents different retry keys creating another task. Different-key same-source and changed-payload same-key requests return 409 Conflict; a matching same-key request replays only after authorization. An existing-task reference is included only if current task visibility is authorized; omit task IDs, links, counts and conversion markers from all client feedback/notification/socket DTOs.
- Deliverable project is mandatory and immutable. Optional task linking/unlinking is Manager-controlled after creation; a Contributor creating a deliverable may supply a valid same-project task. Missing task never bypasses project policy, and a linked task never expands access.
- Flat folder listing inherits project permission; Manager/O/A create/rename/remove empty folders and move listings. Contributors choose a permitted existing folder for upload. Folder names are labels, not storage paths. Forbid cross-project moves/IDs; nonempty-folder removal fails, including archived listings. Folder placement never grants client access to internal files or changes shared-version retrieval.
- Rich-text documents remain internal. Validate a bounded versioned content schema with supported headings/text/lists/bold/italic/HTTP(S) links; normalize paste and reject arbitrary HTML/styles/scripts/embeds and unsafe URLs. Render escaped text through allowlisted components and safe link attributes, not raw HTML. Use optimistic revisions and retain unsaved local edits on conflict.
- Organization description/logo mutation requires O/A; description is escaped plain text. Logo retrieval requires an active internal membership or a client capacity with at least one accessible portal-enabled project in that organization. An asset must belong to that organization and be clean/READY.
- Profile-image upload/attachment/removal/retrieval and preferences are self-only global account operations, also available to authenticated clients. Validate actual owner from the session, not request user/org IDs. No public profile-image URL or cross-user directory is introduced. Use distinct self-owned records and narrowly scoped service processing; no nullable tenant shortcut in project tables.
- Both image types use purpose-bound PNG/JPEG upload intents, limits/scan/safe raster variants and authorized API streams through the existing pipeline. Only a ready-image attachment swaps the pointer after authority recheck; a failed replacement preserves the old image. Cleanup cannot delete an active image reference.
- Optional IN_APP category preferences default enabled and apply prospectively at notification materialization after access evaluation. Disabling creates no new optional notification for that category, does not erase existing notifications, and re-enabling does not backfill skipped events. Preferences never grant access or suppress mandatory verification/recovery/invitation/security messages. The user-facing preference API is self-only; a narrow Identity port permits the notification worker to read preferences only for a previously authorized recipient. Phase 6 implements assignment/review preference effects; Phase 7 exposes discussion/document/client-update categories with their working event sources.
- P36 aggregates published client updates and permitted shared review milestones only within the selected organization/client capacity. Filter each project/event by live grant, portal, publication and relevant share before pagination/counts. Project filter options use that same accessible set; forged/revoked filters yield safe not-found/denied, not an unfiltered feed. Withdrawal/revocation suppresses later reads/emissions. Internal activity, task-conversion data and inaccessible project metadata are excluded.

## PostgreSQL RLS and database roles

The baseline **requires tenant RLS on tenant domain tables**, introduced with identity/tenancy in Phase 2. Project/resource policies remain application responsibilities. Global identity and restricted dispatch/bootstrap paths are explicit exceptions; they must not justify disabling RLS for normal API/worker operations.

- Normal domain runtime roles are nonowner, nonsuperuser, `NOBYPASSRLS`; revoke DDL, TRUNCATE, arbitrary role switching, unsafe functions, and unneeded table privileges. Migration owner credentials never enter API/worker environments. Use FORCE ROW LEVEL SECURITY on tenant tables as additional protection and verify grants/ownership in tests.
- Apply tenant predicates for SELECT/DELETE (`USING`) and INSERT/UPDATE (`WITH CHECK`), including immutable organization ID checks. Missing/invalid transaction context denies access rather than falling back to all tenants. RLS is not a foreign-key replacement, and constraint errors must be normalized to avoid cross-tenant existence leaks.
- Set organization context through parameterized transaction-local configuration on the same pooled connection as every query. No session-level SET, string-concatenated SQL, escaped global-client query, or request-global mutable tenant variable. Commit/rollback must clear context before reuse. Test successive tenants, concurrent requests, exceptions, background tasks, raw SQL, joins, counts, and nested writes.
- The API validates current principal membership before domain queries. Setting a tenant variable alone is not proof of authorization. An attacker who can execute arbitrary application SQL is outside RLS's protection; prevent injection, restrict query APIs, and protect credentials.
- Identity uses restricted global tables/role through self-scoped adapter operations, including profile media/preferences and narrow identity-event dispatch. Its worker purpose cannot list arbitrary users or tenant data. Organization-logo tables require tenant RLS even without project IDs; project file tables keep nonnullable tenant/project scope. A narrow membership/contact resolver establishes only the authenticated user's contexts. Bootstrap creates only the verified caller's organization and first Owner.
- Outbox dispatcher must enumerate cross-tenant committed events. Give it only a reviewed restricted claim/ack/reconcile interface or tightly scoped table role; no domain table reads or general bypass credentials. If SECURITY DEFINER functions are used, fix search_path, qualify names, restrict EXECUTE, avoid dynamic SQL, and review/test each function. A dispatcher lease cannot authorize arbitrary worker actions.
- Tenant-event handlers open fresh tenant transactions under the same restrictions. Identity mail/profile handlers instead use the narrow validated owner/purpose path and cannot enumerate users or enter arbitrary tenant scope. Revalidate event/resource association, initiating authority when needed, and recipient access. Workers never receive migration credentials.

The definitive behavior of RLS/owner exceptions is documented in [PostgreSQL's official policy guide](https://www.postgresql.org/docs/current/ddl-rowsecurity.html). Project-specific connection/ORM behavior is unverified until V02 passes against real PostgreSQL runtime roles.

## Upload, processing, preview, and download security

1. Validate upload purpose and owner: project uploads require an active project and internal contribution permission; organization logos require O/A in that organization; profile images require the authenticated account owner. Generate random staging keys bound to the corresponding owner/intent, expected checksum, type/size and expiry. No user-selected filesystem/object paths or final keys; rate/volume limits apply across all purposes.
2. Staging capabilities expire after a proposed 5 minutes and allow only signed PUT to one generated key via the same HTTPS origin/proxy. Sign write-once `If-None-Match: *`, checksum/type and other required conditions; preserve signed request components. No browser list/read/delete/final-key access. Bound actual streamed bytes at the proxy and verify purpose-specific limits in processing; do not trust claimed length. Capability issuance is session/CSRF protected; possession does not authorize final attachment after access loss. Existing URLs may survive until expiry, but finalization rechecks authority. Prove behavior in V03.
3. Validate actual bytes/digest/signature/type/size and purpose limits, PDF pages, decoder bounds and source identity; never trust extension/browser MIME/Content-Length/ETag alone. Project formats are PNG/JPEG/PDF; logo/profile formats are PNG/JPEG only with stricter limits. Reject SVG/HTML/executables/archives and image-purpose PDF uploads.
4. Isolated scanner/render jobs have time, CPU/memory/page/pixel/output limits, no outbound network, no external URL fetching, and no shell interpolation of filenames. Render untrusted PDFs/images with maintained, pinned tools; reject active/dangerous content and preserve canonical original identity. Use allowlisted safe preview formats. Rendered previews are also private.
5. Read the pinned/write-once staging source, verify real SHA-256, write a unique canonical object with enforced no-overwrite semantics, and verify canonical identity before READY. Job retries reuse a deterministic receipt and cannot replace canonical bytes. If local storage cannot demonstrate these guarantees, block version implementation and revise the adapter; never silently downgrade immutability.
6. Download/preview/range endpoints validate the applicable project/share/client, organization-branding or account-self policy on each request. Resolve keys from scoped records, require clean/available state, and stream with no shared cache. PDF ranges remain project/version scoped. No browser route to staging GET, bucket listings, storage admin or canonical object endpoints.
7. Use safe filenames, Content-Disposition, correct MIME/nosniff, and safe preview delivery. Serve previews in a restrictive context; never inline arbitrary uploaded HTML. Logs redact cookie/Authorization/token headers, signed queries, private filenames/content, and proof links.
8. Revocation blocks newly authorized streams and later range requests. An in-progress authorized response or downloaded copy may already exist; do not promise recall. Proposed final-download signed URLs are deliberately avoided so new requests always pass the API. Do not log or cache object capability URLs in notifications.
9. Expired/orphan cleanup is conservative and reference-aware, cannot delete attached version assets, and needs validated retention defaults. User-facing archive does not trigger an unapproved irreversible purge. Separate cleanup authority from upload/finalization authority.

AWS-specific URL and conditional semantics are background evidence in [ARCHITECTURE.md](ARCHITECTURE.md); S3 compatibility, scan tools, and rendering limits remain V03/V05 validation tasks.

## WebSocket and event security

- Handshake validates allowed Origin, actual DB session, expiry, and chosen capacity. Ignore user-supplied room/role authority and do not put credentials in query strings. Cookie presence is insufficient.
- Every subscription and received event is input-validated and authorized. Room names are built by the server from verified user/capacity/tenant/project IDs. Client contacts cannot subscribe to internal project rooms.
- Server emissions are per-recipient authorized invalidations with minimal IDs/revisions; avoid project names, feedback text, filenames, or participant details in broadcasts. Recheck current session and grant before emission rather than trusting old room membership. Evict/revalidate on logout, expiry, deactivation, and grant changes; reconnect must authenticate again. If validation is unavailable, fail closed.
- Network delivery can lag a completed revocation. Previously authorized in-flight invalidations contain no private content; any following REST read rechecks authorization. There is no claim that an already sent packet can be recalled.
- Queue payloads carry a typed tenant or identity-owner scope, event/resource IDs and schema version, not authority assertions/secrets. Validate scope/purpose against the trusted outbox record before selecting a handler; untrusted payloads cannot choose a privileged identity path. Minimize PII; effects/receipts are transactional where possible.

## Audit and operational protections

Audit organization creation, invitations/acceptance, membership/ownership/grant changes, portal/share transitions, version creation, review opening/cancellation/explicit replacement/decision, feedback-to-task conversion, folder changes, organization branding and sensitive settings/file outcomes. Task mutations also append task history; own image/preferences/security actions use identity audit. Record old/new review IDs and target versions for replacement and source-thread/task IDs only in internal conversion evidence. Sensitive mutation/audit/outbox commit together; failed audit persistence fails the mutation.

Denied attempts cannot be inserted into the rolled-back domain transaction; use a separate bounded security logging path with request correlation, tenant only when safely established, rate limits, and no secret payloads. Audit browsing is Owner/Admin-only; activity and client updates receive separate sanitized projections. Append-only database grants/triggers protect normal runtime writes; a database administrator remains a trusted operator, so do not claim cryptographic tamper-proof logging.

Keep secrets in ignored local environment files/secret injection when later authorized, with safe templates only. Bind local service ports to loopback/private Compose network where possible; no default admin credentials in committed files. Pin versions and investigate security updates through official sources. Backups contain private data and need equivalent access controls. Verify restore consistency between database references and file checksums before functional completion.

## Threat scenarios and required proof

| Threat | Expected defense | Verification |
| --- | --- | --- |
| Tenant A guesses Tenant B project, task, file, review, notification, or cursor | Tenant-qualified queries, RLS, composite FKs, no identifying error payload | T03, T06, T08 |
| Member/Manager escalates role or client contact gains same-client projects implicitly | Action/field policies, explicit grants, invitation binding | T02, T04 |
| Reviewer or internal Admin forges a client approval | Separate principal capacity and named current Approver eligibility | T09, T10 |
| Replacement/decision/revocation race or accidental preparation side effect | Fixed cycle target, explicit atomic replacement, serialized authority, immutable exact-version facts; preparation cannot invalidate decision | T09, T10, T11 |
| Replayed upload overwrites approved bytes | Write-once staging, pinned source, unique final object, no final write capability | T07, T08 |
| Malicious PDF, decompression bomb, executable disguised as image | Byte/type/limit checks, sandboxed scanner/renderer, private quarantine | T07 |
| Stale socket/notification leaks after access loss | Live recipient policy, eviction, sanitized invalidations, REST recheck | T14, T15 |
| Worker retries duplicate a version, approval, notification, or activity | Unique constraints, receipts, state guards, outbox reconciliation | T22, T23 |
| CSRF, session fixation, recovery replay, stolen stale session | Origin/CSRF checks, rotation, expiry, atomic proofs, revocation | T01, T02 |
| Private web data is reused for another tenant/capacity | No shared cache, scoped query keys, reset on switch | T13, T24 |
| Rich-text/feedback/filename injection or media ownership substitution | Structured allowlist, escaping/safe headers, separate media owner scopes, redacted logs | T07, T12, T18, T20, T21 |
| Retry conversion or crafted folder/checklist/source IDs cross project boundaries | Composite ancestry, permanent source uniqueness, current task-create/assignment policy, no client backlinks | T04, T05, T06, T12 |
| Aggregate update filter/count leaks private project activity | Authorize before union/filter/pagination/counts; safe denied filter behavior | T13, T17 |
| Proxy exposes private S3 or invalidates signed PUT conditions | One exact origin, staging-only methods, unchanged signature inputs, private buckets, no host-published storage | T07, T08 |

A checklist entry is not evidence. Concrete test identifiers and recorded outcomes are required by [TESTING.md](TESTING.md). No security or integration tests have run during this planning task.


### Feedback-to-task duplicate contract

For the same authorized actor/scope, the same idempotency key and matching payload replay the original result after authorization. A reused key with a different payload returns 409 Conflict. The same source thread with a different key returns 409 Conflict; include an existing-task reference only if that actor is still authorized to see that task. Client principals never receive internal task references. Permanent source uniqueness and transaction/concurrency protection remain mandatory. This is a Phase 5 contract, not Phase 1 application functionality.

## Phase 1 verification boundary

The [Phase 1 report](PHASE_1_REPORT.md) separates actual HTTPS/cookie/Origin/session/SSR/socket tests from unimplemented product security. The experiment enforces exact Origin, a browser-tested Secure HttpOnly host-only __Host- cookie, live database session reads, thirty-minute database-authoritative inactivity, fixed eight-hour lifetime, verified-only login and a ten-minute recent-auth probe. Successful password reauthentication rotates/revokes the presented old same-user session. Actual verification/recovery expiry, replay and two-process races pass. Database clock values are normalized to UTC; client timestamps cannot refresh authority.

Better Auth owns credential hashing, cookie signatures, verification JWT validation and password reset. Its stateless verification default is supplemented with a digest-only issued-proof receipt and atomic one-time claim. The claim fails closed: a crash between claim and library verification can spend a link and requires a newly issued proof; resending an identical JWT cannot revive it. This is an isolated compatibility adaptation, not a second authority or a production transactional-mail implementation. Production abuse controls, tenancy/RLS, audit, durable mail and full socket invalidation remain unimplemented.

Compose network isolation is statically checked only; Docker is unavailable. Staging denials do not prove S3 signatures or canonical immutability. Secrets and proof fixtures are ignored, certificates are project-local, and no trusted root or Windows security setting was changed.

## Phase 3 implemented authorization paths

`CoreDomain` uses `Organizations.scoped` for live session, selected active internal principal and organization locking. Owner/Admin manage all clients/projects. Members discover only explicitly assigned projects and limited associated client summaries. Project Managers manage their project's work, participation and same-client grants; they cannot create organization projects/clients, edit client contacts or invite organization members. The candidate roster exposes eligible internal display names/IDs only to a Manager, with pagination.

Manager/O/A manage task metadata, one eligible project assignee, milestone/order/priority/deadline/status and checklist structure. Only the assigned active Contributor can change work state and toggle checklist completion. All internal Contributors can post threads/replies on accessible tasks; Viewers read. CANCELLED is Manager-only. Nested lookups validate tenant, project, task and comment/checklist ancestry. Same-revision saves have one winner and recoverable 412 conflicts. Checklist completion never automatically changes task status.

`ClientAccess` resolves selected contact principals separately. Its Phase 3 access-inspection endpoint returns only explicitly granted, portal-enabled project identity/name/status/role. Client principal IDs fail all internal routes, even when the same user has internal membership elsewhere. Client invitation creation remains Owner/Admin-only and acceptance rechecks intended verified email, target contact/project, expiry/revocation/consumption and current issuer authority. Managers grant existing same-client contacts only. Grant/contact revocation is checked live; receipt replay reauthorizes the grant. No formal review/decision/portal-content endpoint is introduced.

Domain writes, sensitive audit and outbox are one transaction. SQL revocation backstops append task history/audit/events when clearing active assignments. Tests use real restricted runtime SQL for RLS, FK, append-only and rollback behavior; migration credentials create synthetic fixtures and fault-injection triggers only. Current results are in [PHASE_3_REPORT.md](PHASE_3_REPORT.md).

## Phase 5 implemented client review boundary

`/portal` operations require a selected active contact belonging to the authenticated verified identity. Each project/resource additionally requires an active explicit grant, active client, enabled portal, nonarchived project, active exact version share and available private asset for bytes. Internal routes resolve only selected Memberships. Formal decisions require the immutable named roster and a current APPROVER grant for that same contact; internal management never satisfies this condition. Conversion and internal resolution metadata never appear in client DTOs. Serialization uses the same organization lock as grant/project changes and live session assertion. Private exact-version reads reuse Phase 4's pinned storage version adapter, no-store and nosniff responses. Existing downloaded/in-flight copies cannot be recalled. The narrow `eligible_contact(uuid)` returns only a tenant-scoped boolean and never fabricates internal membership. See [Phase 5 report](PHASE_5_REPORT.md) for executed evidence and limits.

## Phase 6 implemented communications boundary

Notifications store event/resource references and generic summaries, never copied names, feedback/task text, filenames, signed URLs or internal conversion details. Tenant/recipient/capacity RLS and the shared `notification_access` port filter before counts, pages, marks and socket invalidations. Internal task events cannot address a client principal. Client review/version visibility requires current contact/grant/client/portal/share/available-asset state and an allowlisted public action. Preferences are self-only and prospective, default enabled, and never suppress mandatory identity/security/invitation mail.

`dw2_communications` is a validated NOLOGIN, NOINHERIT, non-superuser/NOBYPASSRLS purpose role behind explicit fixed-search-path EXECUTE interfaces. Its event lookup derives tenant only from a current trusted outbox lease; the login worker cannot query domain/notification/preferences tables directly. New notification rows must match the actual immutable envelope; recipient/category/effect uniqueness and durable receipts prevent duplicate materialization. No API insertion/deletion of notifications is granted. Read timestamp updates cannot rewrite target/history.

Product sockets require exact Origin, actual DB session and strict selected capacity. Subscription and emission policies never trust caller room names. Bounded live revalidation evicts expired/revoked sessions or grants across independent API processes. Hints contain only trusted event/scope references; actual emissions disclose only event IDs and, for authorized project subscriptions, project IDs. Policy-store failures deny data. Redis is expendable transport; durable REST recovery remains authoritative. See [Phase 6 evidence](PHASE_6_REPORT.md) for actual fault tests and inherited limits.
