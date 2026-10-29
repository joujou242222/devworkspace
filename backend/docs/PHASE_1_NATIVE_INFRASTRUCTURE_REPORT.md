# Phase 1 Native Infrastructure Validation Report

Date: 2026-10-16 (Africa/Cairo). Scope: native Windows Phase 1 only.

**Status: Phase 1 native infrastructure exit criteria PASS; awaiting user review.
Phase 2 remains unauthorized.**

This supersedes the mandatory Docker execution gate. The original
[authentication report](PHASE_1_REPORT.md) remains historical evidence.
No product feature, authentication policy, production schema, dependency pin,
commit, push or deployment was introduced.

## Windows and supported WSL rollback

Windows 10 Pro 22H2 x64, build 19045.6466. The two authorized normal reboots were
verified at 01:02:37 and 01:06:12 +03:00 on 2026-10-16.

The registered WSL 3.0.3.0 MSI product
`{2D92E6AF-35B2-4109-893F-59E4A4F2D550}` uninstalled with exit **0**. Its installer
also removed the related Appx registration; these were not two independent
installations and no duplicate removal was issued. Only the WSL optional feature
was disabled through supported DISM with NoRestart, followed by the second reboot.

Final elevated read-only verification: WSL feature **Disabled**; MSI/Appx and
`C:\Program Files\WSL` absent; no current-user distributions; CBS reboot pending
false; no InstallPending/UninstallPending packages. Hyper-V, Virtual Machine
Platform and Windows Hypervisor Platform all remain **Enabled**. No further reboot
is required by this work. No protected system files were manually deleted.

No Docker, Ubuntu, Windows upgrade, BIOS/security-policy change, global PATH
modification or automatic-start service was installed. Native extraction required
no elevation. Ignored evidence:
`.local/wsl-final-verification.json`, `.local/wsl-removal-result.json`,
`.local/wsl-msi-uninstall.log`, `.local/wsl-native-resume-checkpoint.json`.

## Exact native tools, provenance and licensing

| Component           | Actual version                                        | Location under D:\Devworkspace                      |
| ------------------- | ----------------------------------------------------- | --------------------------------------------------- |
| Existing PostgreSQL | 18.4, MSVC 19.44.35226 x64                            | `.local/vendor/postgres-runtime/package/native/bin` |
| Memurai Developer   | 4.1.7; Redis API 7.2.11                               | `.local/vendor/memurai-4.1.7/tools`                 |
| SeaweedFS           | 4.48; commit 530be3e37337488ecc34d58441e0bc476e121c93 | `.local/vendor/seaweedfs-4.48`                      |
| Mailpit             | 1.31.6 Windows amd64                                  | `.local/vendor/mailpit-1.31.6`                      |
| BullMQ / ioredis    | Unchanged pins 6.3.15 / 5.8.2                         | Existing worker dependencies                        |
| Node / pnpm         | Unchanged pins 24.14.0 / 10.18.1                      | Existing toolchain                                  |

[Native tool manifest](../infra/native-tools.json) pins exact official URLs and
archive hashes. SeaweedFS/Mailpit SHA-256 values match published GitHub release
asset digests; Memurai SHA-512 matches the NuGet catalog and its executable has a
Valid Janea Systems Authenticode signature. Repeat setup compares installed
executables with the verified archive entries. Binary digests are retained in
ignored `.local/native/artifacts.json`. No NuGet installation script or MSI ran.
PostgreSQL provenance is unchanged; no new download or cluster initialization.

Sources: [SeaweedFS 4.48](https://github.com/seaweedfs/seaweedfs/releases/tag/4.48),
[Mailpit 1.31.6](https://github.com/axllent/mailpit/releases/tag/v1.31.6),
[Memurai package](https://www.nuget.org/packages/MemuraiDeveloper/4.1.7),
[vendor NuGet distribution](https://www.memurai.com/blog/memurai-developer-available-on-nuget).

Memurai Developer permits development/testing, not production or redistribution;
it requires restarting after ten days. The bundled license remains in ignored
vendor files; no account, paid license or bypass was used.
[Terms](https://www.memurai.com/terms), [limits](https://www.memurai.com/faq).
Its license includes possible data collection/update clauses; local execution is
not a telemetry guarantee. No other installed Memurai was found. SeaweedFS is
Apache-2.0 and Mailpit MIT; upstream license notices are retained.

## Persistence, security and resource boundaries

The original PostgreSQL cluster and ownership marker remain at
`D:\Devworkspace\.local\pg`. No reinitialization or production migration ran.
One subsequent start recovered automatically from an interrupted prior host
process using PostgreSQL WAL; no manual data-file edit was needed. Explicit
shutdown/restart tests then completed normally.

| Service                    | Explicit 127.0.0.1 ports | Retained data                           |
| -------------------------- | ------------------------ | --------------------------------------- |
| PostgreSQL                 | 55432                    | `.local/pg`                             |
| Memurai                    | 6379                     | `.local/native/redis` AOF               |
| SeaweedFS master           | 9333, 19333 gRPC         | `.local/native/storage`                 |
| SeaweedFS volume           | 8080, 18080 gRPC         | Same storage root                       |
| SeaweedFS filer            | 8888, 18888 gRPC         | Same storage root                       |
| SeaweedFS S3               | 9000, 19000 gRPC         | Same storage root                       |
| Mailpit SMTP / UI/API      | 1025, 8025               | `.local/native/mailpit/messages.sqlite` |
| Existing web / API / HTTPS | 3000, 3001, 8443         | Existing application paths              |

Observed owned listeners are recorded in `.local/native/test-bindings.json`;
none of the native service listeners was wildcard/LAN/IPv6-bound. Redis has a
random local password, AOF with appendfsync always, noeviction and a 256 MiB cap.
SeaweedFS uses 32 MiB volumes, at most 16, with single-volume growth from
`infra/native-master.toml`. Large downloads/data remain under the D: checkout.
Setup/start refuse C: below 5 GiB or D: below 20 GiB.

Loopback does not isolate other local users. S3 candidate Admin credentials are
not production file permissions; Mailpit is a synthetic local catcher, not an
outbound mail relay. TLS trust remains scoped to existing tests/certificates; the
Windows trust store was not changed. No global WSL memory/swap settings were made.

Before native setup, after the second reboot: C: **8,397,025,280 bytes** free;
D: **61,245,005,824 bytes** free. Final snapshot at 14:21:19 +03:00:
C: **8,069,156,864 bytes (7.515 GiB)**; D: **60,900,036,608 bytes (56.718 GiB)**.
Changes include concurrent Windows activity, not just installation.

Available RAM was **6.312 GiB** of approximately 16 GiB. Native tools plus the
PostgreSQL main process had a summed working set of approximately **205 MiB**;
including the four application processes, approximately **522 MiB**. These are
snapshots, not peak or unique-memory measurements, and exclude PostgreSQL backend
children, browsers and build tools. Keep Redis capped at 256 MiB, run one local
stack and avoid concurrent heavy builds. No global CPU/swap limits were imposed.
Final measurements, listener ownership and unchanged binary digests are retained
in `.local/native/final-environment.json`. No native Windows services were found.

## Commands and actual outcomes

[Runbook](../infra/README.md) documents `native:setup`, `native:up`,
`native:status`, `native:down`, `native:restart` and `test:native`.
Existing application commands remain intact.

Native shutdown validates PID/executable/start time: Redis SHUTDOWN SAVE, owned
Go-console CTRL_C, and owned pg_ctl fast/wait. It never forces native processes or
deletes volumes. Logs are in ignored `.local/logs/native-*.log`.

| Command / probe                    | Observed outcome                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `pnpm native:setup`                | PASS, including repeat archive/binary verification                                                    |
| `pnpm native:up`, `native:restart` | PASS, owned readiness/shutdown/restart                                                                |
| `pnpm test:native`                 | 7 PASS, including retained PostgreSQL directory and user-count checks                                 |
| PostgreSQL                         | Real SQL/rollback-only temp table, version and loopback port pass                                     |
| Redis/BullMQ                       | Auth required, PING/Lua/config, real immediate/retried/delayed jobs pass                              |
| S3                                 | Signed create/write/read/delete, exact bytes; anonymous/wrong-key rejection pass                      |
| SMTP                               | Actual SMTP capture and message-body verification through Mailpit API pass                            |
| Restart persistence                | AOF key, waiting job, S3 bytes and mail survive; retained job processes                               |
| `pnpm build`                       | PASS, actual pinned packages and Next production build                                                |
| `pnpm dev` / `dev:stop`            | PASS, HTTPS readiness and owned application stop                                                      |
| `pnpm test:integration`            | 20 PASS on final post-restart run                                                                     |
| `pnpm test:e2e`                    | 1 PASS in actual Chromium                                                                             |
| `pnpm check`                       | PASS: runtime, boundaries, docs, static infra, OpenAPI, env, lint, types, 3 unit tests and formatting |
| Docker runtime                     | OPTIONAL / NOT EXECUTED                                                                               |

Persistence evidence: `.local/native/persistence-result.json`. Probes use random
synthetic queue/key/S3 names and clean only those resources; captured mail stays.
Existing authentication proof callbacks still use the original ignored fixture
inbox; separate SMTP probes establish real capture without product mail changes.
The unchanged application health endpoint honestly reports Redis/storage not
checked there; standalone integration tests supply that evidence.

Corrections: PostgreSQL's CIDR text comparison needed host(inet_server_addr()) in
the test; SeaweedFS's initial volume count was insufficient for default seven-
volume growth, corrected with single-volume native configuration. Windows
PowerShell children need a compatible module search path rather than inherited
PowerShell 7 modules; that change affects only child environments. Go shutdown
helpers detach after sending a graceful console signal. Final port inventory also
found optional Iceberg/Lance defaults; both were disabled and the listener check
now rejects ports outside the explicit allowlist. A failed-probe cleanup path was
corrected to avoid using an already closed queue; one stuck disposable test runner
was stopped after its failures were recorded, without targeting service processes.
Some interrupted-run synthetic fixtures and captured messages remain in ignored
local stores; no general cleanup or existing-data deletion was performed. Final
native and regression runs pass. No product/dependency
change was used to hide a failure.

## Revised Phase 1 exit criteria and limitations

Require (1) supported WSL rollback with shared virtualization preserved;
(2) retained PostgreSQL and actual queue/S3/SMTP integrations;
(3) loopback/credentials/negative tests and owned restart/persistence;
(4) unchanged architecture/pins/auth behavior with build/check, twenty auth tests
and browser E2E passing; (5) reproducible commands, provenance/resources/evidence
and stop for review.

Dockerfile build, Compose startup/health/DNS/internal networking/port inspection
and container-volume lifecycle are **OPTIONAL / NOT EXECUTED**, never passed by
native tests. Static Compose validation still runs without Docker. Compose files
and image pins remain unchanged.

Production identity/tenancy/RLS, audit/outbox, V03 immutable upload/integrity/limits,
V05 scanning/rendering, V06 durable product worker recovery and remaining product
scenarios keep their original phase gates. Tested BullMQ operations do not prove
every Redis command or failure mode. No ten-day soak, production deployment or
multi-user host isolation guarantee is claimed.

**Stop at the Phase 1 review gate. No Phase 2, commit or deployment is authorized.**
