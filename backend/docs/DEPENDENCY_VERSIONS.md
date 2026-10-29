# Phase 1 dependency selection

## Phase 4 additions, 2026-10-17

Existing application/runtime/native pins remain. `packages/server` adds sharp **0.35.5** (Apache-2.0) and pdfjs-dist **6.4.299** (Apache-2.0), with pinned lockfile dependencies including the Windows canvas/native renderer packages. Both import and actual restricted rendering were exercised on Node **24.14.0**, Windows 10. These additions do not authorize unrelated upgrades.

Portable ClamAV **1.4.6** (GPL-2.0) uses the official release archive/digest in `infra/processing-tools.json`, verified before extraction; current official FreshClam CVDs are copied into the read-only tool inventory. No scanner service/system install exists. Sources: [official ClamAV release](https://github.com/Cisco-Talos/clamav/releases/tag/clamav-1.4.6), [sharp installation requirements](https://sharp.pixelplumbing.com/install/), [PDF.js releases](https://github.com/mozilla/pdf.js/releases), [ClamAV signature formats](https://docs.clamav.net/manual/Signatures.html). Runtime and isolation evidence is in [Phase 4 report](PHASE_4_REPORT.md).

Recorded 2026-10-15. Exact direct versions are in workspace manifests; transitive resolutions and integrity hashes are in `pnpm-lock.yaml`. Application packages use stable releases. Pins identify the tested combination, not a recommendation to install registry latest.

## Application and toolchain

| Component                                              | Exact version             | Rationale and evidence                                                                                                                                        |
| ------------------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node / pnpm                                            | 24.14.0 / 10.18.1         | Existing runtime; exact engines, packageManager and runtime check                                                                                             |
| TypeScript                                             | 5.9.3                     | Within auth adapter's TS 5.9/6 peer range; avoids incompatible registry TypeScript 7                                                                          |
| Next / React / React DOM                               | 16.4.1 / 19.3.1 / 19.3.1  | Compatible peers; real webpack production build and Chromium test                                                                                             |
| Nest common/core/Express/WebSockets/Socket.IO adapters | 12.1.3                    | Aligned modules; actual HTTP/socket boot                                                                                                                      |
| Prisma CLI/client/pg adapter                           | 7.10.0                    | Stable within Better Auth Prisma 5–7 range; avoids Prisma 8 RC; actual PostgreSQL queries                                                                     |
| Better Auth                                            | 1.7.10                    | API-owned candidate; isolated tests, adoption remains provisional                                                                                             |
| @thallesp/nestjs-better-auth                           | 2.8.0                     | Community adapter linked by Better Auth; peers Nest 11/12, Express 5, Node >=22.22.1, TS 5.9/6                                                                |
| Express / qs                                           | 5.3.0 / 6.14.0            | Explicit peers; body parsing executed                                                                                                                         |
| pg                                                     | 8.23.1                    | Prisma driver and local database utilities                                                                                                                    |
| Socket.IO / socket.io-client                           | 4.8.4 / 4.8.4             | Actual HTTPS session/Origin/revocation checks                                                                                                                 |
| BullMQ / ioredis                                       | 6.3.15 / 5.8.2            | Typed worker connection configuration only; no queue/runtime claim                                                                                            |
| Zod                                                    | 4.6.7                     | Validated environment; unsafe configuration rejected                                                                                                          |
| reflect-metadata / rxjs                                | 0.2.2 / 7.8.2             | Nest peers                                                                                                                                                    |
| ESLint / TS ESLint parser/plugin                       | 10.12.0 / 8.71.2          | Actual lint check                                                                                                                                             |
| Prettier / tsx / yaml                                  | 3.9.10 / 4.23.15 / 2.8.1  | Formatting, TS test loader, static Compose parser                                                                                                             |
| Playwright test                                        | 1.64.1                    | Real Chromium E2E; Chromium revision 1248                                                                                                                     |
| Playwright CLI                                         | 0.1.22                    | Official isolated CLI; its own transitive Playwright is 1.64.0-alpha-1790635538000, a tooling-only prerelease exception, separate from the stable test runner |
| http-proxy                                             | 1.18.1                    | Minimal local HTTPS/WS proxy; Node deprecation warning remains; production proxy choice requires review                                                       |
| @types Node / React / React DOM                        | 24.19.2 / 19.3.0 / 19.3.0 | Exact declaration pins                                                                                                                                        |
| @types Express / pg                                    | 5.0.6 / 8.23.1            | Exact declaration pins; strict typecheck                                                                                                                      |

Strict peer installation and frozen installation were executed. The optional native `msgpackr-extract` build script is intentionally not allowlisted; pnpm reports it skipped. No queue runtime/performance claim relies on it. Workspace build allowlist is explicit.

## Infrastructure images

Registry manifests were resolved and digests recorded. **Docker is absent; these images were not pulled or run.**

| Candidate  | Exact image                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| Node       | `node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8` |
| PostgreSQL | `postgres:18.4-bookworm@sha256:882236b897e39051d2368c5ccc6cda944904723506b2dfc97f2a8f5bc9afa382`     |
| Redis      | `redis:8.2.3-alpine@sha256:08ad0b1d280850169a790dba1393ff7a90aef951fc19632cf4d3ce4f78e679ba`         |
| SeaweedFS  | `chrislusf/seaweedfs:4.48@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d`   |
| Mailpit    | `axllent/mailpit:v1.31.6@sha256:23fe39e81bde596a918000b3135c0f85dc8bb4c9ea6be274b051143f3e300387`    |

PostgreSQL uses its PostgreSQL license; SeaweedFS is Apache-2.0; Mailpit is MIT. Redis 8 offers AGPLv3, RSALv2 or SSPLv1, and must not be described as BSD Redis. No paid account or hosted service was used. Licensing must be reassessed before distribution/deployment. Primary references: [Redis licenses](https://redis.io/legal/licenses/), [SeaweedFS 4.48](https://github.com/seaweedfs/seaweedfs/releases/tag/4.48), [Mailpit v1.31.6](https://github.com/axllent/mailpit/releases/tag/v1.31.6).

ClamAV and PDF.js remain scanner/renderer candidates for V05, not installed or version-selected. Signature freshness, memory requirements, sandboxing and processing caps need Phase 4 execution. The 25 MiB file, 100-page PDF, and 2 MiB avatar defaults remain validation-dependent.

## Local PostgreSQL provenance

Docker absence prevented container-backed V01 execution. A large official Windows archive download was stopped when it did not complete promptly. The optional helper instead uses the existing [embedded-postgres Windows binary package](https://github.com/leinelissen/embedded-postgres), without adding a production dependency or Windows service.

- Artifact: `https://registry.npmjs.org/@embedded-postgres/windows-x64/-/windows-x64-18.4.0-beta.17.tgz` (40,606,855 bytes).
- SHA-512 base64: `AwRerliA4IGWyW5jWBvHt5vidVUSB0QQW9Tt2y7ScnmifnCb/awfxZr4BkBSTv+gNt8Djcddqs+xSF5Z6/CkTg==`.
- Packaging is prerelease **18.4.0-beta.17**, while the binary was checked as stable **PostgreSQL 18.4**. This fixture exception does not imply official binary provenance or production supply-chain approval.
- Artifacts and cluster stay ignored under `.local`; only `127.0.0.1:55432` is bound. Preparation/shutdown check the ownership marker. Only disposable `devworkspace_v01`, four library auth tables and the added `v01_email_proof` receipt table are used. Gap closure reused this existing binary/cluster without another download.

## Primary compatibility sources

Published npm peer/engine metadata and installed manifests were checked, followed by local execution:

- [Node 24.14.0 release](https://nodejs.org/en/blog/release/v24.14.0).
- [Next installation](https://nextjs.org/docs/app/getting-started/installation).
- [Better Auth Nest integration](https://better-auth.com/docs/integrations/nestjs) and [community adapter](https://github.com/ThallesP/nestjs-better-auth).
- [Better Auth Prisma adapter](https://better-auth.com/docs/adapters/prisma), including Prisma 7 driver adapter.
- [Better Auth sessions](https://better-auth.com/docs/concepts/session-management) and [password/recovery](https://better-auth.com/docs/authentication/email-password).
- [Official Playwright CLI](https://github.com/microsoft/playwright-cli).

Installed Better Auth cookie code was inspected to explain its automatic __Secure- prefix. The explicit __Host- session name, mandatory Secure/HttpOnly/Lax/Path=/ attributes, and absent Domain now pass actual HTTP/browser checks. See the [Phase 1 report](PHASE_1_REPORT.md).

## Gap-closure customization and unchanged pins

No dependency version or lockfile resolution changed. The existing Better Auth 1.7.10 public hooks and freshSessionMiddleware provide session-policy integration and the ten-minute probe; the existing Prisma adapter now explicitly enables its supported transaction option. See [official hooks](https://better-auth.com/docs/concepts/hooks), [session management](https://better-auth.com/docs/concepts/session-management), and [email behavior](https://better-auth.com/docs/concepts/email). Installed pinned source was checked alongside those documents.

The library's default verification JWT accepts repeated success; the experiment adds a database issuance/consumption receipt for that exact library-issued token. SHA-256 is only a storage digest, with no custom signer/verifier. Atomic claims and session idle/absolute checks execute on the existing PostgreSQL binary, with explicit UTC normalization on its Africa/Cairo timezone. The unchanged candidate passes twenty integration tests and the browser regression. Production identity and infrastructure runtime adoption remain separate gates.
