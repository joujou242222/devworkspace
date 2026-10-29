# Local foundation infrastructure

## Current Phase 9 verification

Phases 1–8 are accepted for their documented local-development scope. On 2026-10-19 the user explicitly authorized Phase 9 full-system verification, recovery and hardening. Preserve prior storage, AppContainer/ACL, cleanup and operator-recovery limitations. Stop at the Phase 9 review gate; Phase 10 professional design requires separate authorization.

The actual result and stopping recommendation are in [Phase 9 report](../docs/PHASE_9_REPORT.md). Keep native services and the product stack on the existing local setup. Use `pnpm phase9:db-recovery` only when an owned local outage is acceptable, and run native restart tests with the app stopped. `pnpm phase9:workload` creates bounded retained synthetic rows. Read the [Phase 9 backup/restore runbook](#phase-9-backup-and-restore) before snapshot or restore. Reconciliation findings require operator review; do not delete canonical objects or reset the cluster to clear them.

## Phase 8 functional integration (historical procedure)

Phase 8 established the 36-template UI integration. Its original test commands and fixtures are retained below as a reproducible historical procedure; current authority is Phase 9.

## Phase 7 expansion workflow (historical)

During Phase 7, that expansion scope alone was authorized after accepted local Phases 1–6. Preserve storage, scanner/AppContainer/ACL, CVD freshness and operator recovery. Preparation verifies/applies SQL through 0043; never rewrite applied SQL/reset data. No new binary, package, service, credential or Windows setup is needed. Build/start, run `pnpm test:phase7`, then `pnpm test:e2e:phase7`. Interrupting regressions remain serial and mode-separated. Activity/categories reuse the outbox, restricted materializer and operator replay; skipped notices are not backfilled. See [Phase 7 report](../docs/PHASE_7_REPORT.md); stop before Phase 8.

Phase 1 native infrastructure is accepted. Phase 2 adds a separate product database and restricted runtime roles on the same retained PostgreSQL cluster. Run `pnpm setup:local` only for missing local configuration. Generated credentials/certificates remain under ignored local paths; no Windows trust store changes occur.

## Phase 2 application and database

With the existing native services running, run `pnpm phase2:prepare`, `pnpm build`, then `pnpm dev`. Preparation is additive, checks migration hashes/role flags/database ownership, refuses an unrecognized populated database, and never resets the retained cluster or experiment. Product startup reads separate ignored API and worker role files. Migration/owner credentials are stripped from application children; web/proxy receive neither product role file. Product and experiment authentication cannot run together. Use `pnpm dev:experiment` for the retained Phase 1 regression mode after stopping the product stack.

`devworkspace_phase2` contains product identity/tenant tables; `devworkspace_v01` remains the isolated Phase 1 experiment. Both persist through native shutdown/restart. `dw2_owner`, resolver and dispatcher function-owner roles cannot log in. API tenancy (`dw2_api`), library identity (`dw2_identity`), dispatcher (`dw2_dispatch`) and mail consumer (`dw2_worker`) use separate credentials and grants. API/worker never use owner/BYPASSRLS credentials. Native development shares one Windows user's filesystem security boundary.

`pnpm phase2:mail-status` reports pending/completed/exhausted counts through a restricted function. The local operator can inspect failed references with migration/operator credentials, without printing mail envelopes, then run `pnpm phase2:mail-retry identity <event-uuid>` or `pnpm phase2:mail-retry tenant <event-uuid>`. Only exhausted, incomplete events can be retried; replay is audited and completed events cannot be reset. Automatic retries use persisted PostgreSQL availability/leases and eight attempts, with backoff capped at five minutes. Queue loss is recovered from expired incomplete database leases; a 30-second lease is not a guarantee against duplicate SMTP delivery after ambiguous completion.

Mailpit captures real verification/reset/invitation links at its existing local UI. No product proof fixture inbox is used. Outbox/BullMQ records carry references; encrypted mail envelopes stay in restricted mail tables. Preserve `.local/phase2-credentials.json` and its mail key with any private backup; losing the key makes pending envelopes unreadable. Never copy credentials/proof URLs into reports or Git.

Recovery: retain the database and migration ledger, investigate a failed migration (each file is transactional), then add a forward repair migration. Do not edit an applied migration or use Prisma `db push`/reset against the product database. Re-running `phase2:prepare` verifies existing hashes and applies only missing files. Before any future non-additive change, take a private owned-database backup and review recovery separately. Full backup/restore rehearsal remains V08/Phase 9. Phase 2 verification creates uniquely named empty validation databases and synthetic records for inspection; it does not delete existing data.

See the [Phase 2 report](../docs/PHASE_2_REPORT.md) for exact checks and boundaries.

## Native Windows mode (default; Docker/WSL not required)

Run from the repository root on Windows 10 x64 with the existing pinned Node/pnpm.
The retained owned PostgreSQL cluster is `.local/pg`, on loopback 55432. Do not
delete/reinitialize it. `native:up` refuses a missing/unowned PostgreSQL marker.
For a genuinely new checkout, the separately documented disposable experiment
preparation creates its initial cluster; it is not needed to restart this one.

```powershell
pnpm native:setup
pnpm native:up
pnpm native:status
pnpm build
pnpm dev
```

`native:setup` verifies exact archives in `infra/native-tools.json`, extracts only
to `.local/vendor`, compares executable bytes against the verified archives and
checks Memurai's Janea Systems Authenticode signature. It installs no MSI, service,
firewall rule, global PATH entry or application dependency. Downloads and data
remain on D: in this checkout. Setup/start refuse C: below 5 GiB or D: below 20 GiB.
Downloads have bounded timeouts; a digest failure blocks extraction/execution.

`native:up` starts owned hidden console applications, persists PID/executable/start
time records, configures Redis authentication and AOF with a 256 MiB noeviction
limit, and adds its local Redis URL to ignored `.env.local` only if absent. It
refuses to replace a different URL or an occupied port. It reuses the existing
S3 credentials/configuration and project-owned PostgreSQL cluster. No credentials
are printed. The existing `pnpm dev` starts the API, web, foundation worker and
HTTPS proxy; product workers/jobs are not introduced by these infrastructure probes.

| Service | Explicit loopback ports | Retained data |
| --- | --- | --- |
| PostgreSQL | 55432 | `.local/pg` |
| Memurai / Redis API | 6379 | `.local/native/redis` (AOF) |
| SeaweedFS master | 9333, 19333 gRPC | `.local/native/storage` |
| SeaweedFS volume | 8080, 18080 gRPC | `.local/native/storage` |
| SeaweedFS filer | 8888, 18888 gRPC | `.local/native/storage` |
| SeaweedFS S3 | 9000, 19000 gRPC | same storage root |
| Mailpit | 1025 SMTP, 8025 UI/API | `.local/native/mailpit/messages.sqlite` |
| Existing application | 3000 web, 3001 API, 8443 HTTPS | existing project paths |

Use HTTPS 8443 for browser/API/socket traffic. Internal/admin ports are not browser
origins. Loopback limits network exposure; it does not isolate other local users.
S3 requires signatures; generated candidate Admin credentials are local test
credentials, not a production authorization policy. Mailpit captures synthetic
messages locally and is not a production mail relay. Memurai Developer is licensed
only for development/testing and shuts down after ten days; restart it normally.
SeaweedFS uses small 32 MiB volumes, at most 16, growing one at a time according to
`infra/native-master.toml`; data is never cleared by lifecycle commands.

```powershell
pnpm test:native
pnpm check
pnpm test:integration
pnpm test:e2e
```

`test:native` runs actual SQL, authenticated Redis/Lua and pinned BullMQ
producer/worker/retry/delay, signed S3/anonymous rejection and SMTP/API probes. It
also restarts native services and proves retained queued work, AOF keys, S3 bytes
and captured mail. Run this before starting the application or stop the owned app
first, because it restarts PostgreSQL. It deletes only its randomly named queue,
Redis key and S3 object/bucket; captured synthetic messages remain available.
This is Phase 1 compatibility evidence, not V03 immutable uploads or V06 durable
product outbox/recovery validation. Existing authentication callbacks still use
the original ignored proof inbox; the separate SMTP test proves actual capture.

For shutdown/restart, first stop the owned app with Ctrl+C in its `pnpm dev`
terminal (or the existing ownership-checked `pnpm dev:stop` command), then:

```powershell
pnpm native:down
pnpm native:up
# Or, while the application is stopped:
pnpm native:restart
```

Native shutdown validates executable/PID/start time. Redis uses authenticated
SHUTDOWN SAVE, Go services receive CTRL_C in their owned consoles, and PostgreSQL
uses ownership-checked `pg_ctl stop -m fast -w`. A failed graceful stop is reported;
there is no forced process termination or volume deletion. Start refuses concurrent
lifecycle commands; inspect a stale `.local/native/lifecycle.lock` and its owned
processes after an interrupted invocation rather than deleting it blindly.

Exact versions, results and acceptance status:
[native validation report](../docs/PHASE_1_NATIVE_INFRASTRUCTURE_REPORT.md).

## Optional Compose mode

With an existing Docker engine: `pnpm infra:config`, then `pnpm infra:up`. Only loopback HTTPS 8443 is published. PostgreSQL, Redis, SeaweedFS administration/object APIs, mail catcher and worker stay on the private internal network. Services/images are exact-version and digest pinned. Registry manifest existence is not runtime compatibility evidence.

Default Compose API runs foundation mode with authentication disabled. It does not auto-migrate or seed identity. The separate host experiment below uses only disposable v01_* tables. Do not deploy this image or mistake the experimental schema for Phase 2 identity.

Use `pnpm infra:down` to stop this named Compose project without deleting volumes. No script issues down -v or deletes unrelated data. Service administration requires explicit local operator access, not a published admin port.

## Host compatibility mode

This machine lacks Docker. For actual V01 execution: `pnpm setup:local`, `pnpm experiment:prepare`, `pnpm build`, `pnpm dev`. The optional Windows helper runs PostgreSQL 18.4 from an integrity-checked local artifact, only on 127.0.0.1:55432. Its third-party binary packaging has version 18.4.0-beta.17; it is not a production dependency. The stable binary version is checked before execution. All cluster/config files live under .local; no service is installed. The helper refuses unowned clusters.

The host reverse proxy uses the same https://localhost:8443 routing as Compose. API/web bind loopback 3001/3000; browser traffic should use the HTTPS origin. Browser trust is intentionally not installed; automated tests explicitly scope trust/certificate bypass to the isolated test context. Node HTTP checks trust the project certificate only.

The parent `pnpm dev` process owns four child processes and records their IDs locally; Ctrl+C stops only those children. PostgreSQL is separately stopped with `pnpm experiment:stop`, which validates the ownership marker before invoking pg_ctl. Disposable data is retained for inspection; cleanup requires a deliberate owned-path operation.

## Staging route and remaining storage gate

Proxy only permits PUT /dw-staging/<opaque-key> with exact Origin, signature query, signed write-once condition and bounded Content-Length; cookies are stripped. Host/path/query are passed unchanged to S3. Bucket/canonical/admin reads and other staging methods are blocked at the proxy. There is no public S3 port.

SeaweedFS is a free Apache-2.0 candidate. Its generated local admin credentials exist only to initialize an isolated candidate later; no upload API, bucket bootstrap or production storage permissions are implemented in Phase 1. V03 must prove end-to-end signatures, checksums, conditional writes, byte caps and canonical immutability with scoped credentials in Phase 4. Proxy configuration and rejection tests alone cannot establish those guarantees.

Mailpit is configured but not run without Docker. V01 recovery tests capture disposable proof URLs in an ignored fixture inbox instead of claiming SMTP delivery. ClamAV and PDF.js are proposed scanner/renderer candidates for V05, not installed or verified here. No paid service or new product feature is introduced.

## Historical Compose blocker (superseded for local development)

The following records the earlier blocked Docker proposal. The native gate above
and current native report supersede its Docker installation requirement. No Docker
runtime test below is implied by native service success.

Gap-closure inspection again found no Docker/Podman/nerdctl, common installed runtime binaries, Docker engine pipe or configured remote Docker context. The existing WSL stub did not supply a usable distribution listing. No runtime, virtualization feature or Windows service was installed. The working project-local PostgreSQL cluster was preserved and reused.

Minimum user action: make an already approved Docker Engine plus Compose v2 environment available for this project. If none exists, authorize a suitable installation separately; this task does not authorize it. Running elsewhere also requires authorization for project transfer/execution. See the [exact blocked gate and evidence checklist](../docs/PHASE_1_REPORT.md#7-blocker-and-minimum-user-action).

After availability, check versions/resources and free ports; stop only the owned host stack with `pnpm dev:stop` before reusing 8443. Run `pnpm infra:config`, `pnpm infra:up`, and inspect actual service state. Execute PostgreSQL/Redis/S3/SMTP probes through the private network, confirm web/API/worker/proxy readiness and HTTPS routing, and inspect actual published-port/reachability boundaries. Then `pnpm infra:down` and restart the same project to verify owned shutdown/data retention. Never use down -v or stop unrelated services. These are required future checks, not results already achieved here.

The expanded V01 experiment has twenty passing integration checks, including server idle/absolute/recent-auth and two-process proof races. It uses five disposable tables (four library auth tables plus one digest-only email-proof receipt). No queue job, SMTP delivery or storage workflow is implemented. Basic future connectivity will not close V03/V06 product guarantees.

## Phase 3 native product workflow

Current Phase 4 migrations extend the retained preparation command through 0020. This Phase 3 section is historical; the additions below govern file processing.

The existing `pnpm phase2:prepare` name is retained for compatibility; it now verifies the complete additive product migration inventory through 0012. The product database and restricted role names remain unchanged. Use `pnpm native:up`, `pnpm phase2:prepare`, `pnpm build`, `pnpm dev`. No cluster initialization, dependency upgrade or new service is needed.

`pnpm test:phase3` and `pnpm test:e2e:phase3` exercise the real new domain. Stop only ownership-checked application processes before lifecycle tests. If an interrupted native lifecycle leaves `.local/native/lifecycle.lock`, inspect live Node lifecycle processes and process records before removing that exact stale lock; never remove it while its lifecycle process is active. Retain all service data and credential records. See [Phase 3 report](../docs/PHASE_3_REPORT.md) for observed restart limitations and current evidence.

## Phase 4 private storage and processing

User approval on 2026-10-17 permits the dedicated per-user Windows 10 AppContainer and its narrow ACL changes. Run as the ordinary user from `D:\Devworkspace`, preserving all existing data:

```powershell
pnpm dev:stop
pnpm phase4:storage-prepare
pnpm native:restart
pnpm phase2:prepare
pnpm --filter @devworkspace/server build
pnpm phase4:storage-provision
pnpm phase4:processing-prepare
pnpm build
pnpm dev
```

Storage preparation recognizes only its own project-local JWT configuration and scoped identities. Ignored `.local/phase4-storage-credentials.json` and role env files hold secrets. The existing administrator identity is retained; API/worker do not use it. Provisioning refuses unexpected existing canonical bucket/versioning/policy configuration. Do not clear buckets or remove policies to bypass errors.

The scanner archive `.local/vendor/clamav/official.zip` must match `infra/processing-tools.json` and the official release SHA-256. The retained `.local/vendor/clamav/portable` directory contains official `freshclam.exe`. Run it with `--config-file=D:\Devworkspace\.local\vendor\clamav\freshclam.conf` to refresh official CVDs as the trusted operator, outside the sandbox. No updater service exists. Stop jobs before updating; rerun `pnpm phase4:processing-prepare` afterward. Production refuses CVDs older than two days. Preparation copies only verified scanner/DLLs/licenses, pinned Node and required renderer packages, then hashes all files into `.local/processing/tool-inventory.json`. Retain licenses; review pinned updates and rerun isolation tests before adopting them.

### AppContainer profile, ACLs and limits

Profile `DevWorkspace.Phase4.95AB96346D7129D6`, SID `S-1-15-2-2100624772-2192851231-3034805555-373356493-3939974604-1581765035-388516438`, derives from this project path. Windows profile root: `C:\Users\DELL\AppData\Local\Packages\devworkspace.phase4.95ab96346d7129d6`. Exact original ACL snapshots/paths are in ignored `.local/processing/sandbox.json`.

- Dedicated tools: package SID ReadAndExecute, existing operator rights retained.
- Dedicated work root: package SID ReadAndExecute; operator FullControl on this newly created directory; inherited low-integrity label. Each operator-created UUID job directory grants package read/write/execute and deletion of its contents, with explicit denial of deletion of the job directory itself. A child cannot create sibling jobs or hide its directory after a parent crash.
- Newly created default package profile root/AC: inherited Everyone deny for write/delete/change-permissions/take-ownership, preventing another writable area.
- Zero network capabilities, no loopback exemption. The existing exemption list is checked without modification.

Each actual process token must attest AppContainer=true, Elevated=false, Capabilities=0. No handles/credentials are inherited; exactly six explicit Windows/path/temp environment variables are passed. Windows Job limits one active process, CPU 60 seconds, process/job memory, and kill-on-close. Scanner budget: 1536 MiB/90 seconds; renderer: 768 MiB/60 seconds. A 100 ms monitor enforces a sampled 256 MiB/50,000-entry temporary output budget and rejects reparse points. It is not an atomic disk quota. Cleanup confines itself to the newly created UUID job directory after handles close.

`pnpm test:phase4:sandbox` exercises real token/environment, live TCP/UDP negative tests with outside positive controls, Internet/private TCP denial, unrelated filesystem/secrets/tool/profile-write denial, resource controls, actual scanner detection and PNG/JPEG/PDF rendering. UDP callback success without receiver delivery is blocked traffic. If required isolation fails, report V05 BLOCKED; do not weaken it.

### Verified sandbox rollback

Stop the app and wait for tests/jobs. Active launches retain shared lifecycle handles; setup/rollback require exclusive ownership and reject concurrent launches.

```powershell
pnpm dev:stop
powershell.exe -NoProfile -File scripts/processing-sandbox.ps1 -Action rollback
```

Rollback restores medium integrity on the dedicated work directory and saved original ACLs, deletes only this AppContainer via Windows APIs, and retires its state JSON. Project tools/work, credentials/storage/data remain. The lifecycle lock file is not a stale-lock marker: Windows releases its handles on exit. Rollback and recreation were actually executed. Rerun processing preparation before restarting jobs. Never delete unrelated profiles or change exemptions/settings.

### Recovery and staging cleanup

PostgreSQL stores durable proof-bound leases/attempts; Redis is transport. Canonical publication uses deterministic conditional keys and exact-version digest read-back; interrupted SQL completion retries existing identities. Private canonical orphans remain for reviewed reconciliation. Never rewrite immutable rows or mass-delete canonical bytes.

A database-wide advisory lock serializes actual processing across worker instances, and dispatch applies queue backpressure. The reusable sandbox refuses to launch a new parser while any previous temporary job directory remains. A hard worker/launcher interruption can therefore require operator recovery rather than exposing another tenant's temporary content. Stop the app; wait until the sandbox lifecycle lock can be acquired exclusively (no launch remains); inspect the exact retained UUID directory and its failure evidence. Move only that verified temporary directory to an operator-only ignored recovery directory outside the processing work tree, reset its inherited ACLs to that recovery parent, and preserve it for inspection. Verify the work root is empty before retrying bounded FAILED work. Never move canonical/storage/database files or reset attempt counters to bypass a terminal failure. Normal scanner/parser/SQL failures clean their temporary directory and retry without this manual step.

Verified tool manifests are archived under `.local/processing/inventories/{digest}.json`; the digest matches the durable TOOLS processing-step identity. Preserve these operator-only manifests when signatures change so prior CVD/binary identities remain resolvable.

The separate staging cleanup identity deletes exact keys only after expiration plus 24 hours. Locked revalidation excludes active jobs/finalization, canonical assets, immutable versions and active images. Unused/expired/rejected/exhausted unattached intents may qualify. The upload row lock spans deletion and tombstone/audit commit; a crash after remote success retries 404 safely. No bucket-wide listing/deletion exists. Broader V08 retention/restore remains later. Inspect scoped upload/job/processing-step/audit records with approved operator access; never copy private env/capability/credential content into evidence. See [Phase 4 report](../docs/PHASE_4_REPORT.md).

## Phase 9 backup and restore

The Phase 9 local procedure is implemented in `scripts/phase9-recovery.mjs` and guarded by its `snapshot`/`restore` commands. It never resets or overwrites the source PostgreSQL cluster or canonical SeaweedFS data. The successful 2026-10-19 rehearsal is recorded in [PHASE_9_REPORT.md](../docs/PHASE_9_REPORT.md); the evidence files and credentials remain under ignored `.local/phase9`.

Before each run, check ownership and readiness with `pnpm native:status`, then run `pnpm phase9:reconcile`. Review missing/mismatched references, unreferenced canonical versions, pending staging intents and cleanup tombstones. The tool calculates required copy space on C: and D: and stops if available headroom is insufficient. Stop only this checkout's app with `pnpm dev:stop`; the recovery script verifies the app is stopped and the native services are owned before shutdown. Create a cold local snapshot with `pnpm phase9:snapshot`. The output prints a snapshot name under `.local/phase9/snapshot-*`; keep that value for restore.

The snapshot procedure gracefully stops owned API/worker/proxy and native writers, waits for PostgreSQL to stop, copies the PostgreSQL cluster and SeaweedFS files, and verifies file inventories/hashes. It does not claim an atomic PostgreSQL/S3 transaction snapshot. Do not run it while unrelated clients or operators can write directly to either store. Restore to separate data paths and alternate local service ports with `pnpm phase9:restore <snapshot-name>`. The script checks the manifest, starts the isolated PostgreSQL/SeaweedFS copies, compares database/table counts and migration digests, validates RLS/constraints, reconciles exact S3 versions, and executes disposable version/missing-object probes in the clone. It stops only the cloned processes it started, retains the clone for inspection, then checks that the original service data and reconciliation returned unchanged. Finish with `pnpm native:status` and `pnpm phase9:reconcile`.

The physical files are **not encrypted**. They contain tenant data, encrypted mail envelopes, audit evidence and private objects. Restrict access to this user's disk and protect the snapshot with an independently approved encrypted backup mechanism before copying it elsewhere. The snapshot intentionally omits `.env.local`, `.local/phase2-credentials.json`, `.local/phase4-storage-credentials.json`, role environment files, TLS keys, S3/storage identities and scanner/tool manifests. Preserve the original private credentials separately; the mail encryption key is required to read pending encrypted envelopes. A restore on another machine also requires matching pinned binaries/configuration and private credential/key material. Losing that material can make private data, pending messages or storage inaccessible.

Canonical unreferenced versions and keys are detected and retained. Do not delete them based only on a hash-only reconciliation sample. Resolve their provenance through authorized operator evidence, then apply the approved retention decision in a separately reviewed change. Likewise, inspect an active/pending staging intent and resume/expire it through the scoped cleanup workflow; never use bucket-wide delete/list or ad-hoc SQL. The Phase 9 rehearsal found 32 unreferenced canonical versions in 16 keys and one active/pending staging intent. It also retained all objects and source databases. Snapshot/restore directories and failed rehearsal copies consume disk until an operator reviews and removes a specifically identified owned path; this implementation does not apply a backup retention or purge schedule.

## Phase 5 native workflow

The retained `pnpm phase2:prepare` now checks migrations through 0027, without changing earlier SQL or role credentials. Use existing native services/processing tools, `pnpm build`, then `pnpm dev`. Run `pnpm test:phase5` followed by `pnpm test:e2e:phase5` (the browser suite consumes only its ignored synthetic integration fixtures). Run earlier suites serially when they deliberately interrupt SMTP or native services; stop the app before `pnpm test:native` and experiment-mode tests. No new dependency/service/profile/ACL setup is required. Recovery is additive forward migration, never reset or canonical object deletion. Retain [Phase 4 recovery limits](../docs/PHASE_4_REPORT.md); see [Phase 5 report](../docs/PHASE_5_REPORT.md).

## Phase 6 notifications and recovery (historical procedure)

Current authority accepts Phases 1–5 for their verified local scope and authorizes Phase 6 only. Preserve all prior local storage/processing recovery limits. `pnpm phase2:prepare` validates/adds SQL through 0034; never rewrite an applied migration, reset a database, clear Redis globally or remove canonical objects. Native tools, AppContainer/ACLs and credentials are unchanged.

Run `pnpm build`, `pnpm dev`, `pnpm test:phase6`, then `pnpm test:e2e:phase6`. The backend suite prepares only ignored synthetic browser fixtures; the browser logs in normally. Run service-interrupting suites serially. The product API receives the existing private Redis URL only for best-effort hint subscription; identity quotas and REST authorization remain PostgreSQL-backed. A disconnected hint transport does not authorize stale data or replace REST catch-up.

`pnpm events:status` uses the existing restricted worker environment and returns up to 100 content-free delivery entries (claim attempts, state, backoff/lease and projection completion). `pnpm phase2:mail-status` retains aggregate lane counts. For an inspected exhausted/incomplete event, use `pnpm events:retry identity|tenant <event-uuid>`. The existing restricted replay function checks exhaustion/lease/completion, appends dispatch audit and retains effect receipts; it cannot reset a completed event or backfill skipped preferences. Do not expose operator credentials in API/web or treat a Redis job count as durable completion.

Redis interruption: keep PostgreSQL/event/receipt data, restore only the owned native Redis process using the existing lifecycle tooling, and allow expired PostgreSQL leases to recreate incomplete work. Do not flush other queues or reset attempts through ad-hoc SQL. SMTP interruption: restore owned Mailpit and let persisted bounded retries resume; inspect/replay exhausted events. SMTP may duplicate after ambiguous success, while one-time proof authority remains unchanged. The failure tests remove only one newly created isolated test job to demonstrate accepted-job loss, and restart Redis with SAVE; they do not prove a blanket Redis wipe is safe.

A process interruption during file parsing can still leave isolated work residue. Follow the prior inspection/preservation recovery procedure with no active parser; never disable the fail-closed guard or broaden AppContainer/profile/ACL permissions. Full canonical orphan reconciliation, backup/restore and performance certification remain later gates. [Phase 6 report](../docs/PHASE_6_REPORT.md) records actual verification and the required stop before Phase 7.
