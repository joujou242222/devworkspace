# Phase 5 implementation report

Date: 2026-10-17. Scope: the user's full Phase 5 authorization; Phases 1–4 accepted for their documented local development scope.

## 1. Exit status

**PASS — approved Phase 5 local functional scope completed and verified.** Exact-version client reviews, formal decisions, image/PDF annotations, portal access and feedback conversion operate through real services. All required phase regressions ran during this implementation. Phase 6 and professional redesign require separate authorization.

## 2. Feature and operation inventory

Implementation: `packages/server/src/reviews.ts`, additive SQL 0021–0027, `packages/contracts/src/phase5.ts`, operation inventory/generated client/OpenAPI, `apps/web/app/reviews.tsx` and the portal/internal server routes. Controllers remain thin; the existing product adapter delegates to the review service. No dependencies were added or upgraded.

All paths below are beneath `/api/v1/organizations/{organizationId}`. Every tenant call requires the current session and `X-Organization-Principal`. Internal and client paths select distinct capacities; no authority union is performed.

| Operation             | Method and tenant-relative path                                                      | Input → output                      | Capacity |
| --------------------- | ------------------------------------------------------------------------------------ | ----------------------------------- | -------- |
| reviewVersionRead     | GET `/projects/{projectId}/versions/{versionId}`                                     | none → reviewRecord (200)           | internal |
| reviewVersionPreview  | GET `/projects/{projectId}/versions/{versionId}/preview/{pageNumber}`                | none → binaryFile (200)             | internal |
| reviewVersionDownload | GET `/projects/{projectId}/versions/{versionId}/download`                            | none → binaryFile (200)             | internal |
| reviewFeedbackRead    | GET `/projects/{projectId}/reviews/{reviewId}/feedback/{feedbackId}`                 | none → feedbackPage (200)           | internal |
| portalFeedbackRead    | GET `/portal/projects/{projectId}/reviews/{reviewId}/feedback/{feedbackId}`          | none → feedbackPage (200)           | client   |
| portalProjectsPage    | GET `/portal/projects`                                                               | none → reviewPage (200)             | client   |
| portalProjectOverview | GET `/portal/projects/{projectId}`                                                   | none → reviewRecord (200)           | client   |
| reviewsList           | GET `/reviews`                                                                       | none → reviewPage (200)             | internal |
| projectReviews        | GET `/projects/{projectId}/reviews`                                                  | none → reviewPage (200)             | internal |
| reviewOpen            | POST `/projects/{projectId}/reviews`                                                 | reviewOpen → reviewRecord (201)     | internal |
| reviewRead            | GET `/projects/{projectId}/reviews/{reviewId}`                                       | none → reviewRecord (200)           | internal |
| reviewReplace         | POST `/projects/{projectId}/reviews/{reviewId}/replace`                              | reviewOpen → reviewRecord (201)     | internal |
| reviewCancel          | POST `/projects/{projectId}/reviews/{reviewId}/cancel`                               | empty → ok (201)                    | internal |
| reviewVersions        | GET `/projects/{projectId}/versions`                                                 | none → reviewPage (200)             | internal |
| versionShare          | PATCH `/projects/{projectId}/versions/{versionId}/share`                             | versionShare → shareRecord (200)    | internal |
| reviewFeedbackList    | GET `/projects/{projectId}/reviews/{reviewId}/feedback`                              | none → feedbackPage (200)           | internal |
| reviewFeedbackCreate  | POST `/projects/{projectId}/reviews/{reviewId}/feedback`                             | reviewFeedback → reviewRecord (201) | internal |
| reviewFeedbackReply   | POST `/projects/{projectId}/reviews/{reviewId}/feedback/{feedbackId}/replies`        | feedbackReply → reviewRecord (201)  | internal |
| reviewFeedbackResolve | POST `/projects/{projectId}/reviews/{reviewId}/feedback/{feedbackId}/resolution`     | feedbackResolution → ok (201)       | internal |
| reviewFeedbackTask    | POST `/projects/{projectId}/reviews/{reviewId}/feedback/{feedbackId}/task`           | feedbackTask → coreRecord (201)     | internal |
| portalProjects        | GET `/portal`                                                                        | none → reviewPage (200)             | client   |
| portalReviews         | GET `/portal/reviews`                                                                | none → reviewPage (200)             | client   |
| portalProjectReviews  | GET `/portal/projects/{projectId}/reviews`                                           | none → reviewPage (200)             | client   |
| portalVersions        | GET `/portal/projects/{projectId}/versions`                                          | none → reviewPage (200)             | client   |
| portalVersionRead     | GET `/portal/projects/{projectId}/versions/{versionId}`                              | none → reviewRecord (200)           | client   |
| portalReviewRead      | GET `/portal/projects/{projectId}/reviews/{reviewId}`                                | none → reviewRecord (200)           | client   |
| portalDecision        | POST `/portal/projects/{projectId}/reviews/{reviewId}/decisions`                     | reviewDecision → reviewRecord (201) | client   |
| portalFeedbackList    | GET `/portal/projects/{projectId}/reviews/{reviewId}/feedback`                       | none → feedbackPage (200)           | client   |
| portalFeedbackCreate  | POST `/portal/projects/{projectId}/reviews/{reviewId}/feedback`                      | reviewFeedback → reviewRecord (201) | client   |
| portalFeedbackReply   | POST `/portal/projects/{projectId}/reviews/{reviewId}/feedback/{feedbackId}/replies` | feedbackReply → reviewRecord (201)  | client   |
| reviewPreview         | GET `/projects/{projectId}/reviews/{reviewId}/preview/{pageNumber}`                  | none → binaryFile (200)             | internal |
| reviewDownload        | GET `/projects/{projectId}/reviews/{reviewId}/download`                              | none → binaryFile (200)             | internal |
| portalReviewPreview   | GET `/portal/projects/{projectId}/reviews/{reviewId}/preview/{pageNumber}`           | none → binaryFile (200)             | client   |
| portalReviewDownload  | GET `/portal/projects/{projectId}/reviews/{reviewId}/download`                       | none → binaryFile (200)             | client   |
| portalVersionPreview  | GET `/portal/projects/{projectId}/versions/{versionId}/preview/{pageNumber}`         | none → binaryFile (200)             | client   |
| portalVersionDownload | GET `/portal/projects/{projectId}/versions/{versionId}/download`                     | none → binaryFile (200)             | client   |

Open, replace, decision and conversion require UUID `Idempotency-Key`; replace, cancel, decision and sharing require `If-Match`. The same authorized actor/key/payload replays the original result; changed payload conflicts. Receipt operation keys include selected principal and path. Client revocation is checked before receipt lookup. All open/replace inputs include the selected exact version ID and SHA-256 digest. Other feedback writes are append-only user actions; UI prevents overlapping submissions.

## 3. Review and decision state machine

`OPEN → APPROVED | CHANGES_REQUESTED | CANCELLED | SUPERSEDED`. There is no transition out of a terminal state. ANY_ONE is the sole policy: one named, currently active eligible client Approver suffices. CHANGES_REQUESTED requires a nonblank reason. Rejection is represented by that approved revision-request state; no undocumented REJECTED state was added.

Only explicit replacement creates an old SUPERSEDED/new OPEN pair. Selected target, policy, cycle number, opener, creation time and frozen roster are immutable. A new cycle on a never-approved shared version can follow a terminal cycle. Approved versions cannot be reviewed again. Project completion requires no unfinished tasks and no OPEN reviews. Portal disable, target-share revocation, project archive and deliverable archive atomically CANCEL affected OPEN cycles with audit/outbox effects. Re-enabling or re-sharing never reopens history. Grant revocation removes current authority without inventing a decision or necessarily closing the cycle. Opening requires an ACTIVE project, enabled portal, active client/deliverable and available clean shared target. Deadlines are informational, not an invented expiry state; session/invitation expiry and live grant/share/portal withdrawal deny access independently.

## 4. Persistence and recovery

0021 adds VersionShare, ReviewCycle, ReviewParticipant, ReviewDecision, Approval, FeedbackThread/Reply/Resolution and Task.source_feedback_thread_id. Composite tenant/project/deliverable/version/contact/grant FKs bind ancestry. Unique indexes enforce one OPEN cycle per deliverable, one replacement per source, one decision/approval per cycle, one approval per version and one task per feedback source. Source links survive task archive. Historical records are insert-only; runtime roles cannot update/delete decision/approval/feedback history. Deferred consistency triggers require cycle/decision/approval status, version, digest and actor agreement.

0022 adds lifecycle, eligibility and annotation backstops. 0023 extends the existing transactional outbox kind allowlist and corrects polymorphic trigger row access. 0024 separates verified client-contact eligibility from internal-member eligibility. 0025 freezes roster inserts to the creating transaction, preserves share identity/revision and rejects closed/private replies. 0026 rejects a JSON-null annotation discriminator at the SQL boundary. 0027 enforces active opening eligibility and transactional resource-lifecycle cancellation and blocks project completion while OPEN reviews remain. All eight new tables have ENABLE/FORCE RLS and tenant-local policies. Existing restricted role names, ownership and no-BYPASSRLS properties are retained.

The migration runner verifies all existing hashes and applies only new SQL. Applied migrations were never edited. Recovery is forward-only: stop app/jobs for operator inspection, preserve migration ledger/database/private objects, add a reviewed corrective migration. No reset, db push, canonical deletion or cross-system rollback claim. Phase 4's pinned storage-version, orphan, scanner/tool, crash residue and backup/restore limitations remain in force.

## 5. Permission and visibility matrix

| Capability                      | O/A / Manager                                       | Contributor      | Internal Viewer  | Client Viewer | Client Reviewer       | Named current Approver                        |
| ------------------------------- | --------------------------------------------------- | ---------------- | ---------------- | ------------- | --------------------- | --------------------------------------------- |
| Internal project review/history | Yes                                                 | Assigned project | Assigned project | No            | No                    | No                                            |
| Share/open/cancel/replace       | Yes                                                 | No               | No               | No            | No                    | No                                            |
| Internal feedback               | Read/write                                          | Read/write       | Read             | No            | No                    | No                                            |
| Shared client feedback          | Read/write                                          | Read/write       | Read             | Read          | Read/write while OPEN | Read/write while OPEN                         |
| Resolution                      | Yes, even readable terminal cycle in active project | Yes              | No               | No            | No                    | No                                            |
| Formal decision                 | No internal authority                               | No               | No               | No            | No                    | Yes, if current grant and frozen roster match |
| Create source task              | Yes, same active project                            | No               | No               | No            | No                    | No                                            |

Contact affiliation alone grants nothing. Clients receive no task ID, conversion marker, resolution note/history, internal comment, checklist, team email or raw object key. Same-client ungranted projects remain unavailable. Grant/share/portal/archive and session checks run under the existing organization serialization boundary; in-flight authorized bytes may finish and previously downloaded copies cannot be recalled.

## 6. Annotations and UI

Typed IMAGE_PIN `{x,y}` and PDF_POINT `{page,x,y}` use normalized canonical orientation coordinates. Server and SQL validate finite bounded coordinates, strict shape, exact cycle/version/digest, MIME, verified page existence and source preview dimensions. PDF pages are 1-based. The UI inverse-transforms quarter-turn rotations against the actual rendered content box; zoom/scroll offsets do not become stored pixel coordinates. Source bytes remain unchanged. Comments, replies and resolution events preserve attribution/timestamps. Initial feedback text/visibility/target are immutable; editing was not specified.

P25/P26 and P32–P35 use minimal semantic controls calling actual APIs. Portal invitation continuation, explicit capacity selection, dashboard/project review summaries, shared history, exact-version labels and download/preview are integrated. Preview blobs are private and revoked on cleanup. Pending form input remains on failed mutation; explicit reload refreshes stale revisions. Idempotent commands retain their retry key for the same mounted form/payload.

P18 shows an authorized original-feedback link for converted tasks. Internal task detail resolves the immutable source's cycle in the same tenant/project and returns only its cycle UUID in the allowlisted DTO. The link opens that exact thread using the existing scoped feedback-read operation, including when it is outside the ordinary feedback page. Feedback links forward to the internal task; no source-task fields are added to client review responses. Archive/portal/share controls confirm their cancellation consequences before submission.

## 7. Integration and concurrency evidence

`tests/phase5/reviews.test.mjs`: 15 scenarios exercise actual HTTPS/Nest, PostgreSQL restricted API role, native scanner/renderer worker and private S3. Tests cover immutable target/frozen roster, client/project isolation, real image/PDF geometry and wrong-version/page/type rejection, visibility/replies/resolution, preparation/sharing while N stays OPEN, conversion concurrency/replay/source uniqueness, replacement/replay, two Approvers, replacement versus decision, audit-failure rollback, forced RLS/history denial, grant/share revoke, two replacements and failed replacement rollback, preparation versus decision (both commit), and exact binary/range/digest reads with security blocking.

Races hold the real organization row on an independent connection and observe both requests waiting before release. The winning order is allowed to vary. Deferred constraints and permanent uniqueness remain effective after receipts. Unit coordinate-transform and browser evidence are recorded in the final verification table.

The remaining six integration scenarios cover decision event rollback/foreign principals; internal role separation and terminal conversion eligibility; restricted SQL roster/geometry/source guards; security-blocked share revocation/exact badges; resource-lifecycle cancellation/completion/rollback and live grant/share/archive races; and own-session revocation versus decision. Both race operations must be observed waiting on a held database boundary before release. Session revocation uses the real session row; a committed decision before revocation remains historical, while subsequent access must fail.

## 8. Verification commands and results

All commands run from `D:\Devworkspace`. Logs are ignored `.local/phase5-*.txt`; final safe aggregate evidence is copied to `docs/verification/phase5-final.txt`.

| Command                                                            | Observed result                                                                                                      |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `pnpm phase2:prepare`                                              | PASS; additive 0021–0027, all 27 applied hashes verified                                                             |
| `pnpm test:phase5`                                                 | PASS 21/21                                                                                                           |
| `node --test --test-timeout=600000 tests/phase5/security.test.mjs` | PASS 3/3                                                                                                             |
| `pnpm test:e2e:phase5`                                             | PASS 2/2                                                                                                             |
| `pnpm test:phase2`                                                 | PASS 20/20                                                                                                           |
| `pnpm test:phase3`                                                 | PASS 27/27                                                                                                           |
| `pnpm test:phase4`                                                 | PASS 24/24                                                                                                           |
| `pnpm test:e2e`                                                    | PASS 1/1                                                                                                             |
| `pnpm test:e2e:phase3`                                             | PASS 2/2                                                                                                             |
| `pnpm test:e2e:phase4`                                             | PASS 3/3                                                                                                             |
| `pnpm test:native (app stopped)`                                   | PASS 7/7                                                                                                             |
| `pnpm test:integration (experiment mode)`                          | PASS 20/20                                                                                                           |
| `pnpm test:e2e:experiment (experiment mode)`                       | PASS 1/1                                                                                                             |
| `pnpm build`                                                       | PASS; web/API/worker/packages                                                                                        |
| `pnpm check`                                                       | PASS; runtime, boundaries, docs, infrastructure, OpenAPI, environment, lint, typecheck, 11 unit tests and formatting |
| `pnpm check:docs; git diff --check`                                | PASS; final documentation and whitespace checks                                                                      |

The complete 21-scenario suite passed after lifecycle/digest corrections. The final task-source backlink addition was then checked by the three role/security integration scenarios and both browser scenarios. Earlier Phase 2–4 integration/browser suites were rerun after lifecycle changes; Phase 1 experiment and native suites ran earlier in this same implementation, in their required isolated modes. No skipped tests are included as passes.

## 9. Failures and corrections

Initial fixture treated an upload response as an asset DTO; corrected to the pipeline's existing same-ID asset identity. Immutable version/feedback reads used a row helper requesting FOR UPDATE, which the restricted insert-only role correctly denied; immutable reads now use SELECT within the shared organization lock. Outbox rejected the new event kind; additive 0023 corrects the allowlist. A reused member eligibility helper incorrectly required clients to have internal membership; 0024 introduces the narrow contact check. Contract test validation now handles JSON Schema anyOf/oneOf and finite numeric fields, preserving strict object validation.

A conversion denial test accidentally selected an internal thread and expected 403 rather than safe 404; it now explicitly selects client-visible feedback. Race tests no longer assume which key wins. One interrupted/timed-out run later threw synchronously before entering test-lock cleanup; moving invocation inside try/finally prevents a leaked test lock. Only the inspected owned Phase 5 test process was stopped, releasing its transaction. A fresh full run passed 15/15. No production permission was broadened to make tests pass.

Browser checks exposed ambiguous nested labels and native coordinate-step validation; explicit accessible labels and unrestricted numeric steps preserve real click-generated coordinates. The rotated portrait PDF frame now reserves swapped bounds. Visual inspection then found the page CSP blocked fetched private blob images even though the image elements were visible. The image policy now permits `blob:` only in `img-src`; browser checks require decoded natural dimensions before placing image/PDF points. The lifecycle fixture now processes a new asset for every version, respecting the existing one-asset/one-version binding. A replacement test also avoids toggling an already-open history panel closed. Product rules discovered during verification were completed with additive 0027 and explicit digest confirmation, rather than weakening acceptance checks.

After repeated regression/build restarts, a browser upload failed with PROCESSING_UNAVAILABLE. Inspection found three temporary scanner/input files matching the Phase 4 synthetic malformed-PNG fixture by size and digest. The existing crash-residue guard correctly denied new processing. With the ownership-checked app stopped and no active parser found, those exact files were moved within this repository to ignored `.local/phase5-preserved-residue`, with all three SHA-256 identities checked before/after. No file was deleted, canonical object changed, ACL/profile altered or guard disabled. This is an execution of the inherited operator-recovery procedure, not a claim that worker termination has automatic recovery.

## 10. Preservation, limits and next gate

Existing Git staging/untracked work is retained. Baseline SHA-256 identities were recorded in ignored `.local/phase5-baseline.json` before edits; final inventory is linked below. The lockfile and prior applied SQL 0001–0020 are unchanged. No commit, push, deployment, dependency install/upgrade or Windows configuration change was performed. Native/Phase 4 regressions perform their existing scoped cleanup of synthetic test resources; no broad purge or canonical deletion was performed. These checks do not constitute a full preexisting-object content audit or restore rehearsal. [File preservation evidence](verification/phase5-files.json) records every baseline identity and the final additions.

Phase 6 notification preferences/materialization, socket emissions, Phase 7 expansions (including P36 updates), final certification, full backup/restore and professional redesign remain deferred. Current review events are durably emitted through the existing outbox; delivery UI/recipient projections are Phase 6. Organization-wide serialization trades throughput for a single revocation/decision ordering; no distributed PostgreSQL/S3 atomicity is claimed.

Recommended next scope is review and acceptance of this Phase 5 report, including inherited local-storage/recovery limits. Phase 6 may start only after separate authorization.
