# Phase 1 gap closure and final validation

**Historical Compose-era report.** The approved Windows-native infrastructure
transition and current exit status are recorded in
[PHASE_1_NATIVE_INFRASTRUCTURE_REPORT.md](PHASE_1_NATIVE_INFRASTRUCTURE_REPORT.md).
The Docker availability gate below is superseded for local development; its
unexecuted Docker tests remain optional and have never been counted as passed.

Date: 2026-10-15. **Overall Phase 1 exit: PARTIAL. Requested V01 compatibility checks: PASS. Infrastructure execution: BLOCKED. Phase 2 has not begun and remains unauthorized.**

This record supersedes the initial assessment. The [original report](verification/phase1-initial-report.txt) is retained verbatim as historical evidence. Dependency versions, application structure, package boundaries, loopback topology and all original passing behaviors are preserved. Exact pins and provenance remain in [DEPENDENCY_VERSIONS.md](DEPENDENCY_VERSIONS.md). No package upgrade, production feature, commit, push, deployment, system installation or trust-store change occurred.

## 1. Gaps resolved

- Added a server-authoritative 30-minute inactivity gate around Better Auth's existing PostgreSQL session, without a second credential/session authority. Activity cannot move its eight-hour absolute ceiling.
- Added a minimal sensitive-operation probe using Better Auth's own ten-minute fresh-session middleware. Valid password reauthentication rotates the session and revokes the presented old same-user session.
- Enabled verified-only login. Real email proof consumption, expiration, signature rejection, replay and races are exercised.
- Added an atomic PostgreSQL receipt for library-issued email verification proofs, because the pinned library's default JWT verification is stateless and repeatable.
- Enabled the Prisma adapter's supported transaction option and exercised expired/reused/concurrently consumed recovery proofs with real password/session effects.
- Updated fixtures to verify identities before login, correlate proof messages by synthetic email, and exercise two independent API processes sharing the real database.
- Preserved all eight previous integration checks, the working browser/SSR/socket flow, pins, local PostgreSQL cluster, and all 36 planned product templates.

The requested authentication gaps are closed for this isolated compatibility scope. This is not production identity or completion of T01–T25. SMTP/outbox delivery, production abuse controls, tenancy/RLS and product workflows remain outside this experiment.

## 2. Files changed in this gap-closure task

| File                                                                                                     | Change                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| apps/api/src/experiment/auth.ts                                                                          | Supported before/after hooks for session policy, proof receipt, verified-only policy, reauthentication rotation, recent-auth probe; transaction-enabled existing Prisma adapter |
| packages/database/prisma/experiment/schema.prisma                                                        | Add lastActivityAt to disposable session and one v01_email_proof receipt table; no production migration                                                                         |
| packages/database/src/experiment-policy.ts                                                               | New parameterized PostgreSQL activity/expiry and atomic email-proof receipt operations                                                                                          |
| packages/database/src/index.ts                                                                           | Export the narrow experiment policy helpers                                                                                                                                     |
| tests/helpers/experiment.mjs                                                                             | New correlated synthetic proof/account helpers                                                                                                                                  |
| tests/integration/compatibility.test.mjs                                                                 | Preserve eight regressions with verified account setup and correlated recovery fixture                                                                                          |
| tests/integration/security-gaps.test.mjs                                                                 | Twelve new real security checks, second API lifecycle, four trials per proof race                                                                                               |
| tests/e2e/foundation.spec.ts                                                                             | Real verification before browser sign-in; retain cookie, SSR, API, logout/login checks                                                                                          |
| README.md; infra/README.md                                                                               | Current results, experiment boundaries and exact blocked infrastructure procedure                                                                                               |
| docs/ARCHITECTURE.md; docs/SECURITY.md; docs/IMPLEMENTATION_PLAN.md; docs/TESTING.md; docs/DATA_MODEL.md | Current D04/V01 evidence, session/proof adaptations, isolation boundary and remaining gate                                                                                      |
| docs/DEPENDENCY_VERSIONS.md                                                                              | No pins changed; record supported hook/transaction customization and fifth isolated receipt table                                                                               |
| docs/PHASE_1_REPORT.md; docs/verification/phase1-files.txt                                               | Current report and full reviewable file inventory                                                                                                                               |
| docs/verification/phase1-initial-report.txt                                                              | Preserved initial report, historical rather than current status                                                                                                                 |

All working-tree files remain uncommitted; Git was initialized during initial Phase 1 and still has no commits or remote. Generated clients/build files, credentials, TLS keys, proof inbox and database files remain ignored. The [full inventory](verification/phase1-files.txt) includes initial foundation additions as well as this task; it is not a claim that every listed path changed again.

## 3. Authentication V01 matrix

PASS denotes the stated reproducible experiment only. The final integration suite has **20 tests: 20 PASS, 0 FAIL**.

| Requirement                                                                  | Status     | Execution evidence                                                                                                              |
| ---------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Nest Express / Better Auth / Prisma PostgreSQL                               | PASS       | Actual API requests and persistent rows; original compatibility checks retained                                                 |
| Auth and ordinary JSON parsing                                               | PASS       | Signup/login/reset and nested versioned echo POST                                                                               |
| Secure, HttpOnly, host-only __Host- session, SameSite=Lax, Path=/, no Domain | PASS       | Real HTTPS Set-Cookie assertions and Chromium cookie inspection                                                                 |
| Database session persistence, logout and revocation                          | PASS       | Independent requests, server deletion, stale-cookie rejection and browser logout                                                |
| Thirty-minute idle timeout / activity refresh                                | PASS       | 29-minute idle session refreshes; 31-minute idle rejects/deletes; forged client clocks cannot revive it                         |
| Eight-hour absolute lifetime                                                 | PASS       | Initial stored interval asserted; activity preserves expiresAt/createdAt; >8h rejects even with artificially later expiresAt    |
| Ten-minute recent authentication                                             | PASS       | Nine-minute session accepted; 10m1s session rejected; normal activity does not renew authentication age                         |
| Reauthentication / rotation / invalidation                                   | PASS       | Wrong password fails; valid password creates fresh cookie and revokes presented old session; logout invalidates fresh probe     |
| Exact Origin / cookie mutation CSRF boundary                                 | PASS       | Foreign/missing Origin rejected; valid login/logout retained; no global TLS or CORS bypass                                      |
| Next.js server-side forwarding                                               | PASS       | Fixed internal API and no-store reads; authenticated and idle-expired SSR states, plus browser reload/login/logout              |
| Socket.IO server session checks                                              | PASS       | Actual WebSocket session/Origin rejection, database revocation and connected-session idle expiry recheck                        |
| Verified-only login and actual email proof consumption                       | PASS       | Unverified signup has no session; login rejected until proof succeeds; database verified flag then login succeeds               |
| Expired / tampered email proof                                               | PASS       | Expired database receipt, genuinely expired library-signed JWT and altered signature rejected without verifying user            |
| Reused / concurrently consumed email proof                                   | PASS       | Sequential replay rejected; four trials, four simultaneous requests across two API processes, exactly one success per trial     |
| Recovery expiry / replay / password update                                   | PASS       | Actual expired proof rejected without password/session effects; sequential replay rejected; new password succeeds and old fails |
| Recovery race / all-session revocation                                       | PASS       | Four trials across two API processes; exactly one success, proof removed, both previous sessions rejected                       |
| Production invitation/tenant/resource authorization, RLS                     | NOT TESTED | Outside Phase 1; V02 and domain scenarios remain future gates                                                                   |
| SMTP delivery/outbox, production limiter/anti-enumeration guarantees         | NOT TESTED | No SMTP runtime; local fixture is not mail delivery or a production abuse-control proof                                         |
| Proactive cross-process socket revocation broadcasts and product rooms       | PARTIAL    | Handshake/event rechecks proven; broader V07 behavior remains in its later phase                                                |

No unresolved failing requested V01 check remains. The scoped compatibility result supports Better Auth **with the documented server policy and proof receipt**, rather than its unchanged defaults. Production adoption still requires the separate identity design/implementation and review in Phase 2.

## 4. Session idle, absolute and recent-auth evidence

Better Auth remains the sole credential, signed-cookie and session authority. A supported before hook reads the cookie through Better Auth's signature verifier, then applies a parameterized PostgreSQL policy to that existing session row. The hook runs for library HTTP requests and auth.api calls used by the Nest guard, SSR and Socket.IO. The existing Prisma adapter is retained, including its transaction boundary; no session lookup implementation is replaced.

The atomic UPDATE succeeds only when expiresAt is future, createdAt is less than eight hours old, lastActivityAt is less than thirty minutes old, and the associated user is verified. It updates only lastActivityAt. Failed gates delete that same stale session row; no upsert or cookie can recreate it. All policy time comes from the database, normalized to UTC because the experiment's Prisma timestamp columns have no timezone. This was actually tested on the unchanged Africa/Cairo PostgreSQL cluster.

Activity means an authenticated library request or session validation, including SSR/socket reads; it is not inferred from browser timers. Test setup directly ages disposable database rows instead of waiting thirty minutes/eight hours. Those SQL fixture operations are available only in the test process, never through an API timestamp override.

The no-op POST /api/auth/v01-sensitive uses the library's freshSessionMiddleware and freshAge=600. It changes no product state. Ordinary activity cannot alter createdAt or grant freshness. Successful password login with a valid old cookie rotates the identity and deletes that presented old same-user session; failed password login does neither. Tests prove both old-cookie rejection and fresh-session logout. Other independent sessions are preserved on reauthentication; password reset revokes all.

## 5. Verification and recovery race evidence

The original baseline was reproduced before changing behavior:

- A session whose last recorded update was 31 minutes old was still accepted.
- A real verification proof returned HTTP 200 on first use and again on replay.

Installed library source explains the second result: the default verification proof is a signed JWT and already-verified users return success. A minimal issuance/consumption receipt now stores only SHA-256 of the library-issued JWT, user ID, expiry and consumption time. It does not mint or authenticate tokens. Better Auth still verifies JWT signature/expiration and performs email verification.

Only the existing library email callback registers a proof. INSERT ON CONFLICT DO NOTHING never resets an existing consumed receipt. A conditional UPDATE ... RETURNING claims each unexpired receipt once in PostgreSQL, across API processes. The supported before hook rejects missing/expired/consumed receipts. Standard Node SHA-256 is used solely as a storage digest; no custom cryptographic primitive or alternate identity authority was introduced.

Claims fail closed: a crash or downstream verification failure after claim can spend the link before account update; the user then needs a newly issued link. A resend that produces the identical JWT cannot resurrect a consumed receipt. This is at-most-once consumption, not a claim that receipt/verification/email delivery form one atomic distributed transaction. Durable mail/retry design remains Phase 2.

Recovery uses the pinned library's own consume and credential-update path with its supported transaction-enabled Prisma adapter. Tests send four simultaneous requests, alternating the HTTPS stack and a second independently running Nest API on loopback 3002. They share the actual PostgreSQL database and secret; no process-local lock can alone explain the result. For each of four email and four recovery trials, **one request succeeds and three fail**. Replay fails afterward. Recovery also changes the password once and invalidates two existing sessions.

The second API port is checked before startup, its requests model the private HTTP API hop, and only the spawned child is stopped afterward. No unrelated process is interrupted. Proofs are never printed in test output; the correlated fixture inbox remains ignored. The library's existing recovery proof storage is a disposable candidate implementation, not a production digest-storage approval.

## 6. Infrastructure execution results

**BLOCKED: no approved container runtime is available here.**

Non-destructive inspection found no docker, podman or nerdctl command; common Docker Desktop, Podman and Rancher Desktop binary locations are absent. The docker_engine named pipe is absent and DOCKER_HOST/DOCKER_CONTEXT are unset. The existing wsl stub did not provide a usable distribution listing; nothing was installed or enabled.

pnpm infra:config was actually rerun and returned exit 1 because docker is unavailable. pnpm check:infra passes only static YAML/network/published-port/digest checks. No Compose container startup, service connectivity, container health, private-port reachability or shutdown is claimed.

The existing project-local PostgreSQL 18.4 cluster remains intact, running on 127.0.0.1:55432. Host web/API/worker/proxy boot and the real PostgreSQL experiment pass. No fresh binary download was attempted. Redis, SeaweedFS and Mailpit remain configured but NOT TESTED. File signing/immutability V03 and worker recovery V06 remain later gates regardless of eventual connectivity success.

## 7. Blocker and minimum user action

Provide an **already approved Docker Engine plus Compose v2 environment** for this project. Reusing an existing approved environment avoids installing system software. If none exists, explicitly authorize a suitable runtime installation separately before any Docker/WSL/virtualization/service changes.

The smallest next authorization is **Phase 1 infrastructure validation only**: make that environment available and authorize running this existing pinned Compose project there, with disposable data and the same loopback TLS origin. A different host also requires explicit authorization for project transfer/execution; none occurred in this task. See [Docker Engine](https://docs.docker.com/engine/install/) and [Compose installation options](https://docs.docker.com/compose/install/) for platform prerequisites.

Required evidence to close this gate:

1. Engine/Compose versions, available ports and existing resources; no unrelated services stopped.
2. pnpm infra:config and pnpm infra:up (including the actual pinned Dockerfile build).
3. Actual PostgreSQL query, Redis PING, authenticated S3 candidate connectivity and Mailpit SMTP capture, executed through private service networking.
4. Web/API/worker/proxy startup, liveness/readiness and browser-to-API through https://localhost:8443.
5. Runtime published-port inspection and reachability checks proving DB/Redis/storage/mail/admin/worker ports are not externally exposed.
6. pnpm infra:down, owned-project shutdown and restart, retaining volumes. No down -v or unrelated cleanup.

The existing [infrastructure runbook](../infra/README.md) records commands and preserves the distinction between configuration, basic connectivity and later product guarantees.

## 8. Full regression commands and outcomes

All commands ran from D:/Devworkspace using the existing pins. The final recorded outcomes are:

| Command                                      | Result                                                                                                                        |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| pnpm install --frozen-lockfile               | Exit 0; unchanged resolution/pins; existing optional msgpackr-extract build warning                                           |
| pnpm experiment:prepare                      | Exit 0; additive disposable schema sync; owned PostgreSQL reused, no download                                                 |
| pnpm db:generate                             | Exit 0; generated experiment client, ignored                                                                                  |
| pnpm build                                   | Exit 0; all packages/API/worker and actual Next production build                                                              |
| pnpm check                                   | Exit 0; runtime, boundaries, docs, static infra, OpenAPI, env, lint, typecheck, unit tests and formatting                     |
| pnpm lint / pnpm typecheck                   | Exit 0; also executed individually during development                                                                         |
| pnpm test                                    | Exit 0; 3 unit tests pass, included in check                                                                                  |
| pnpm test:integration                        | Exit 0; 20 tests pass, including twelve new checks and eight race trials across two processes                                 |
| pnpm test:e2e                                | Exit 0; 1 real Chromium test passes, with verification and secure cookie/SSR/login/logout regression                          |
| pnpm check:infra                             | Exit 0, static only; included in check                                                                                        |
| pnpm infra:config                            | Exit 1, docker unavailable; runtime validation BLOCKED                                                                        |
| pnpm dev:stop / pnpm dev                     | Owned app shutdown and restart exercised; fresh stack readiness event, actual PostgreSQL connected, worker bootstrap evidence |
| git diff --check and working-tree inspection | Exit 0; reviewable uncommitted files and ignored secrets/artifacts checked                                                    |

The first policy integration run had **13 PASS / 7 FAIL**: implicit comparison between UTC timestamp columns and a Cairo timestamptz clock incorrectly expired fresh sessions. Explicit UTC normalization corrected it, and all twenty tests subsequently pass. No package or OS timezone change was used to hide the issue.

Additional source review kept policy in the supported request hooks instead of wrapping a database lookup, preserving the adapter's own transaction behavior. Raw local logs/browser evidence remain ignored. No test result is inferred from file existence.

## 9. Exit criteria and remaining limits

| Phase 1 criterion                                                       | Status  |
| ----------------------------------------------------------------------- | ------- |
| Working minimal web/API/worker; build/lint/typecheck/tests              | PASS    |
| Enforced package boundaries and validated configuration                 | PASS    |
| Reproducible requested V01 compatibility/session/proof evidence         | PASS    |
| Executed full private Compose infrastructure, connectivity and shutdown | BLOCKED |
| Updated decisions/evidence and stop at review gate                      | PASS    |

**Every Phase 1 exit criterion passed: NO. Overall Phase 1 remains PARTIAL because infrastructure execution is blocked.** There is no remaining failed requested authentication compatibility check.

The experiment still has no production onboarding, organizations, roles, tenant CRUD/RLS, projects/tasks/clients/files/reviews, notifications or professional design. V02–V08, production audit/outbox/abuse controls, full socket revocation and operational recovery retain their original phase gates. The 25 MiB file / 100-page PDF / 2 MiB avatar defaults remain unverified capabilities. No storage guarantees were inferred from proxy rejection tests.

## 10. Exact recommended next authorization

Authorize **only the remaining Phase 1 infrastructure validation** described in section 7 after an approved runtime is available. Do not authorize Phase 2 based on authentication test success alone.

Once that evidence passes and the Phase 1 exit is accepted, separately authorize the existing [Phase 2 identity, tenancy and security foundation](IMPLEMENTATION_PLAN.md#phase-2--identity-tenancy-and-security-foundation): production identity/session/verification/recovery and own-account text/password/sessions; organization onboarding/settings/internal invitations/roles/ownership/Access; reviewed migrations, nonowner roles and transaction-local RLS with V02; audit/outbox/idempotency and actual local mail; thin real P01–P07/P13/P29/P31 interfaces and required T01/T02/T03/T06 tests. File/media controls, notification preferences, domain CRUD and professional design remain in their later phases.

**Stopped at the Phase 1 review gate.**
