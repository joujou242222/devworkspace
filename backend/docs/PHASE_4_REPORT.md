# Phase 4 — Secure files and immutable deliverables

2026-10-17. **PASS — Phase 4 implementation and verification complete; awaiting user review.** Phases 1–3 are accepted. Phase 4 has not yet been accepted by the user; Phase 5 remains unauthorized.

## 1. Status and authorization

The complete Phase 4 request authorizes local implementation, tests and minimal UI. Separate user approval permits the dedicated per-user Windows 10 AppContainer and its narrow ACLs, with no network capabilities, and automatic deletion of expired unattached staging objects 24 hours after expiration. No commits, pushes, deployments, Windows upgrade, Docker, WSL, service, global PATH or firewall changes are authorized or performed.

V03 passes for the verified local storage behavior and exact-version identity described below. The Phase 4 portion of V05 passes real scanner/renderer isolation tests; annotation geometry remains Phase 5. Only the explicitly approved staging subset of V08 is complete. This PASS does not certify the deferred portions of those gates.

## 2. Feature and endpoint inventory

All routes use `/api/v1`. Internal project routes require a current selected organization principal and project authorization:

| Family                                              | Operations                                                                                                             |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `/organizations/{org}/projects/{project}/folders`   | GET/POST; PATCH/DELETE `/{folder}` with revision                                                                       |
| `.../files`                                         | GET list/read; PATCH listing title/folder/archive with revision                                                        |
| `.../uploads`                                       | POST intent; GET list/read; POST `/{upload}/finalize` and `/retry`                                                     |
| `.../deliverables`                                  | GET list/read; POST create; PATCH metadata/task/archive with revision                                                  |
| `.../deliverables/{deliverable}/versions`           | GET history; POST explicit ready asset preparation                                                                     |
| `.../assets/{asset}/download` and `/preview/{page}` | Authorized binary reads, exact stored S3 version, optional single range                                                |
| `/organizations/{org}/logo`                         | GET pointer, PATCH explicit ready attachment/removal, GET `/content`; POST `/uploads`, GET upload, POST finalize/retry |
| `/me/image`                                         | Same media operations with self ownership, independent of tenant membership                                            |

Generated OpenAPI and TypeScript contracts enumerate exact paths and DTOs. Owner/Admin and project Manager manage folders/listings; Contributor may upload and prepare versions; Viewer reads internal ready files. Clients receive no internal project-file authority. Logo writes require organization Owner/Admin; profile writes require the authenticated owner. Completed/archived projects retain reads and deny writes. This phase does not share versions with clients or create review cycles.

## 3. Migrations and storage schema

Additive migrations 0013–0020 introduce project folders, upload intents, immutable assets/previews, separate availability, file listings, deliverables, immutable versions, durable file/media jobs, separate logo/profile scopes, staging cleanup tombstones, and append-only processing steps. 0016 corrects historical folder hint handling; 0019 supplies a narrow audited profile mutation function; 0020 extends cleanup to rejected/exhausted jobs. Applied SQL is hash-checked and never edited. Prisma scalar mappings preserve SQL ownership of composite FKs, RLS and triggers.

`dw-staging` contains only opaque upload keys. `dw-canonical` is versioned and Object Lock-enabled, with a deletion-deny policy. All persisted assets/previews pin returned S3 version IDs and SHA-256 identities. Metadata API responses do not expose object keys, storage credentials or internal storage versions. Existing databases, buckets and administrator identities are retained.

## 4. Processing and quarantine lifecycle

ISSUED → UPLOADED → PROCESSING → READY, REJECTED or FAILED. Expired unused intents become EXPIRED during eligible cleanup. Finalize checks live permission, expiration and actual staged length, then commits a durable job; it does not declare bytes safe. Workers load a five-minute proof-bound lease, verify byte length/digest, run real ClamAV, decode/render inside AppContainer, validate outputs, publish create-only canonical objects, read exact versions back, then atomically insert ready assets/previews/listing, audit and outbox. Failed attempts are bounded at five with delayed retry. Quarantine has no download/preview route.

Processing records persist stage, outcome, lease, tool identity and time without content. The TOOLS identity hashes the verified inventory, including binaries and CVD hashes; content-addressed operator-only manifests retain those exact identities across updates. Intermediate stages remain visible to operators after interruption; successful completion is a separate database transaction. A database-wide advisory lock serializes worker instances, and queue backpressure bounds dispatch. The work root permits package read/execute only; an individual job has writable contents and cannot delete its own directory or create siblings. Crash residue blocks new parsers until the documented operator recovery; ordinary failures clean their directory automatically.

## 5. Immutability and recovery

Version rows and canonical identity metadata reject UPDATE/DELETE through database triggers. Composite keys enforce tenant/project/deliverable/asset ancestry. Organization serialization and deliverable row locking allocate monotonically increasing version numbers; preparing the same asset again returns its existing version. New versions change only the latest-prepared pointer and never transfer approvals.

SeaweedFS 4.48 does not support the AWS `s3:if-none-match` policy condition tested here. Conditional creation works, including races, but is supplemented by immutable pinned S3 versions and a canonical deletion-deny policy. A trusted writer can create a new latest storage version; it cannot change the bytes served for an existing database-pinned version. This is not per-object legal-hold certification: publication does not set a legal-hold header. Administrator credentials remain an explicit trusted operator boundary.

Object publication and PostgreSQL are not one transaction. Retries reuse deterministic keys, verify existing bytes on 412, and pin the verified version. Failed SQL completion leaves private orphan objects for reconciliation; it never creates a ready record prematurely. Canonical/orphan recovery and broader retention remain V08 work in their approved later phase.

## 6. Storage permissions and isolation

API: staging read/write for signing/finalization, canonical read. Processor: staging read and canonical read/write. Separate cleanup identity: staging write/delete only. None has administrator permission. Raw filer/volume access uses project-local JWT security; readiness authenticates without logging tokens. Browser PUTs are same-origin path-style signatures binding method, Host/path/query, expiration, length, MIME, checksum and `If-None-Match: *`; browser storage requests omit cookies.

The AppContainer profile and precise rollback procedure are in [the native runbook](../infra/README.md). Real negative tests cover TCP/UDP loopback, private/Internet TCP, unrelated files, project secrets, tool writes and default profile writes, with outside positive listener controls. UDP callback success alone is not delivery; receiver packet counts determine isolation. Resource controls include one active process, CPU/job/process memory budgets, wall timeout, and a monitored 256 MiB temporary output budget. The disk monitor is sampled, not an atomic filesystem quota.

## 7. Scanner and renderer evidence

Official portable ClamAV 1.4.6 archive SHA-256: `57b6fd1d60cd87bafe800f97407ecdef0576d36b3900b8b7abcfbbabe88295fd`. Official FreshClam loaded and tested main 63, daily 28155 and bytecode 339. Production requires CVD freshness of at most two days and fails closed on unavailable/incomplete scans. Scanner output requires one scanned file, zero infection and no warning/error/skip. ClamAV temporary files stay in the dedicated job directory.

PNG/JPEG processing uses sharp 0.35.5; PDF.js 6.4.299 renders real pages. Project limits are 25 MiB, media 2 MiB, PDF 100 pages, project images 40 million pixels and media 10 million pixels. Project previews fit 1600 pixels; media 512. PDF JavaScript, attachments and XFA are rejected; malformed or excessive content cannot become READY. Licenses and pinned tool sources are in `infra/processing-tools.json`.

The harmless scanner fixture uses an explicit custom hash signature alongside official CVDs. ClamAV 1.4.6 skips directly supplied non-CVD files when `--fail-if-cvd-older-than` is enabled; the fixture probe omits that option, while production retains it and accepts only official CVDs. No antivirus setting was disabled. EICAR could not be read reliably under the existing host protection and is not the claimed successful detection fixture.

## 8. Concurrency, failure and cleanup

Staging cleanup holds the upload row lock over eligibility revalidation, exact-key remote deletion and audit/tombstone commit. It requires expiration plus 24 hours, an unattached intent and no active job/canonical asset. Eligible states are ISSUED/EXPIRED, REJECTED or exhausted FAILED. Active/finalizing/ready assets, versions and images are protected. A crash after deletion rolls back SQL; retry accepts missing objects and commits one tombstone/audit. No bucket listing or unrestricted bucket deletion occurs. Broader V08 retention/restore remains deferred.

## 9. Functional UI

P21 project files/folders, P22 deliverables/version history, P18 task link, P29 organization logo and P31 own profile image use real APIs. Uploads show actual transfer/processing states, safe retry, errors and role/lifecycle restrictions. Preview/download reads reauthorize; conflicts retain unsaved form input. Upload progress is indeterminate during the real operation, not an invented percentage. UI is semantic HTML/light CSS; professional design and Phase 5 annotations/review remain deferred.

## 10. Executed checks

Final command evidence is collected in [phase4-final.txt](verification/phase4-final.txt). The retained Phase 1 experiment was run separately against its existing database; the product stack was then restored. Repeated and targeted runs are not counted as additional unique tests.

| Command                                 | Tests/result                                                                                                               | Exit |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---- |
| `pnpm check`                            | runtime, boundaries, documentation, infrastructure config, OpenAPI, environment, lint, typecheck, 9 unit tests, formatting | 0    |
| `pnpm build`                            | database generation and all workspace production builds                                                                    | 0    |
| `pnpm test:native`                      | 7/7                                                                                                                        | 0    |
| `pnpm test:phase2`                      | 20/20                                                                                                                      | 0    |
| `pnpm test:phase3`                      | 27/27                                                                                                                      | 0    |
| `pnpm test:phase4`                      | 24/24: 16 API/database/storage/worker and 8 real sandbox/scanner/renderer tests                                            | 0    |
| `pnpm test:e2e`                         | 1/1 retained identity browser journey                                                                                      | 0    |
| `pnpm test:e2e:phase3`                  | 2/2 retained collaboration browser journeys                                                                                | 0    |
| `pnpm test:e2e:phase4`                  | 3/3: files/versions including pagination, own image and organization logo                                                  | 0    |
| `pnpm --filter @devworkspace/web build` | final web build after folder-selection correction                                                                          | 0    |
| `pnpm test:integration`                 | 20/20 retained Phase 1 integration tests                                                                                   | 0    |
| `pnpm test:e2e:experiment`              | 1/1 retained Phase 1 browser journey                                                                                       | 0    |

The Phase 4 suite covers permission revocation, tenant/project ancestry, immutable version races, actual storage checksum/conditional/version behavior, SQL/audit failure rollback, leased retry, interrupted cleanup, expiration boundaries, concurrent finalization/cleanup, cross-worker serialization, stale work rejection and real processing limits. Browser checks use actual APIs and persistence, including invalid upload errors and retained unsaved input on conflicts. Test accounts, files and objects are synthetic; security-critical integrations are not mocked.

Earlier `pnpm test:phase4:sandbox` runs passed seven tests before the disk-limit case was added; the final aggregate includes all eight. Targeted cleanup and storage-policy negatives passed during diagnosis. `node .local/phase4-preservation.mjs`, `node .local/phase4-lock-preservation.mjs` and `node .local/phase4-inventory.mjs` exit 0. Final documentation/formatting checks and `git -c core.safecrlf=false diff --check` exit 0. No skipped test is presented as passed.

## 11. Failures and corrections

Actual failures found and corrected: anonymous raw filer reads; JWT-aware native readiness; Windows renderer path/module resolution; AppContainer default profile write access; trusted launcher absolute path/PATHEXT; ClamAV temporary path; unsupported conditional bucket policy; insufficient legal-hold publication permission (replaced with the documented version-pinning design); profile audit table permission (narrow function); stale return-path unit expectation. SQL corrections are additive. Rollback was initially started while a sandbox test still ran; lifecycle locking now prevents that race, rollback/recreation succeeded twice, and the final eight-test sandbox suite passed. Unknown preexisting profiles are refused rather than adopted; the collision path was negatively tested.

A live cleanup worker could win the failure fixture race: eligible rows and the injected SQL fault now become visible in one transaction. A failed intermediate run was 23/24; the corrected full run passed 24/24. UDP listener binding could hang the fixture: independent ephemeral TCP/UDP ports, explicit bind rejection and positive-control timeouts corrected it. Failure-fixture transactions now close in `finally`; only verified owned hung test process trees were stopped. Phase 2 SMTP outage fixtures are run serially with account-dependent suites. Combining retained Playwright files exposed their shared pool teardown; separate pinned browser aliases all passed. Alert assertions were scoped around Next's route announcer. Starting browser tests before application readiness produced a non-JSON foundation response; rerun after the ready event corrected it.

Final UI inspection found that folder pagination could reset a file's folder while renaming. An initial fallback-option fix still reproduced the reset: replacing a selected option allowed the browser's uncontrolled selector to choose Root. The folder selector now keeps controlled state and a fallback option outside the loaded page; the real browser regression passes and checks the persisted folder after rename. Its first run also exposed an exact accessible-label mismatch; the selector now has an explicit accessible name. Typecheck caught an optional-property mismatch while extracting the control; null normalization corrected it before the successful build.

## 12. Preservation

Baseline copies/hashes of 153 existing files are retained under ignored `.local/phase4-baseline*`: 121 unchanged, 32 intentionally changed, zero missing. [The file inventory](verification/phase4-files.json) distinguishes baseline modifications from added source and records SHA-256 identities. Existing Git staging/untracked work is preserved; no reset, clean, commit or push is used. Existing PostgreSQL and storage data remain. Applied 0001–0012 migration hashes remain unchanged. All 497 existing lockfile package records remain unchanged; 13 pinned transitive/new package records were added for processing. Test data and synthetic private objects are retained for inspection; no broad cleanup is claimed.

## 13. Deferred work and risks

No formal review, client sharing/approval, anchored annotation, full client portal, notification preferences, expansion feature or professional redesign is implemented. Later V05 annotation geometry and V08 full backup/restore/canonical retention are not certified. Local hardware, CVD freshness, trusted operator credentials, sampled disk limits and organization-wide mutation serialization remain explicit operational constraints. File processing is serialized across worker instances. Hard-crash work residue requires documented operator inspection/recovery before processing resumes. Windows AppContainer is the verified native Windows 10 path; other platforms require their own isolation verification. No final cross-system certification or per-object legal-hold claim is made.

## 14. Recommended next action

Review and accept or request corrections to this Phase 4 result. The recommended next implementation scope, only after explicit authorization, is Phase 5: exact-version shares/review cycles, eligible client decisions and approvals, image/PDF anchored annotations and portal, explicit active-review replacement and feedback-to-task conversion with authorization/concurrency tests and minimal UI. Professional redesign remains deferred. No Phase 5 work has begun.
