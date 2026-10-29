# DevWorkspace engineering instructions

## Mission and delivery policy

- Build a multi-tenant B2B SaaS for agencies: LaunchFlow delivery management, OrbitSpace collaboration, and Proofly version-specific client review.
- Use a modular monolith: Next.js/React/TypeScript web, NestJS/TypeScript API and worker, PostgreSQL/Prisma, REST/OpenAPI, Redis/BullMQ, Socket.IO, and private S3-compatible storage. Choices remain provisional until their validation gates pass.
- Follow **backend-first, functionality-complete, design-later**. Implement domain rules, integrity, authorization, contracts, and tests first; integrate a minimal real Next.js UI in each functional slice.
- Use semantic HTML and lightweight CSS. Interactive features, including image/PDF annotations, need working interfaces. No mock APIs, placeholder operations, or hardcoded demo data in functional flows.
- Finish and verify all 36 templates, including the seven expansion templates, before professional UI/UX redesign. Keep presentation replaceable.
- Phases 1–8 are accepted for their documented local-development scope. On 2026-10-19 the user explicitly authorized complete Phase 9 full-system verification, recovery and hardening. Preserve prior storage, AppContainer/ACL, cleanup and operator-recovery limitations. Stop at the Phase 9 review gate; Phase 10 professional design requires separate authorization.

## Before and during changes

- Inspect repository status, existing files, applicable instructions, and relevant documents before edits. Preserve existing work and completed functionality; investigate unexpected changes before touching them.
- Keep changes scoped and reviewable. Do not install dependencies, scaffold applications, or create infrastructure during planning.
- Repository boundaries: `apps/web`, `apps/api`, `apps/worker`; `packages/server`, `packages/database`, `packages/contracts`, `packages/config`; `infra`; `docs`.
- Keep controllers, gateways, and jobs thin. Put use cases and policies in server modules; export explicit interfaces. Web and contracts must not import database or server internals.
- Use versioned REST DTOs and generated client contracts. Never expose ORM records as public contracts. Validate all untrusted input.
- Record architectural changes, alternatives, rationale, consequences, and verification in the decision register in `docs/ARCHITECTURE.md`; add separate ADRs only when needed.

## Security and correctness

- Deny access by default. Validate the session, active principal, tenant, resource ancestry, permission, visibility, and lifecycle state on every access path.
- Scope tenant records and relationships by `organization_id`. Use composite integrity constraints and transaction-local RLS context; runtime roles must not bypass RLS. RLS supplements resource authorization.
- Separate internal membership from client access. Client affiliation alone grants no project access; only eligible client approvers can make formal review decisions.
- Never overwrite deliverable versions or transfer approvals to another version. Enforce transitions and concurrency in database transactions.
- Use private storage, quarantined uploads, authorization on download, append-only sensitive audit records, transactional outbox, and idempotent workers.
- Keep secrets, tokens, private content, and signed URLs out of source control and logs. Use local free infrastructure by default.

## Definition of Done for implementation tasks

- The approved acceptance criteria and page/feature IDs are mapped to implementation, permissions, and evidence as defined in `docs/TESTING.md`.
- The real API, persistence, and minimal UI work together; relevant empty, error, forbidden, conflict, and recovery states work.
- Schema changes include reviewed constraints, migrations, RLS, and a recovery approach. Sensitive mutations include audit/outbox effects where required.
- Relevant unit, integration, API, authorization, concurrency, and E2E checks pass; existing functionality remains intact. Run the repository's actual pinned checks, not invented commands.
- Review the diff and run documentation checks and `git diff --check` when Git exists. Document unresolved issues honestly.
- Report commands actually run, outcomes, and limitations. Never claim unrun tests or unvalidated compatibility passed.

## Authority boundaries

- No deployments, paid services, destructive operations, external writes, pushes, or commits without explicit authorization for that action. A plan or local implementation request is not deployment authorization.
- Follow narrower task boundaries. Do not change global Codex configuration or files outside this repository for this initialization task.
- Stop at the approved phase gate and report evidence and the exact recommended next scope.

## Detailed references

- [Project entry point](README.md)
- [Product and all 36 pages](docs/PRODUCT_SPEC.md)
- [Architecture and decisions](docs/ARCHITECTURE.md)
- [Data model and state ownership](docs/DATA_MODEL.md)
- [Security and permissions](docs/SECURITY.md)
- [Phases and approval gates](docs/IMPLEMENTATION_PLAN.md)
- [Testing and traceability](docs/TESTING.md)
