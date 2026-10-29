# Role Access Matrix (41 Pages + Mutations)

Measured exact HTTP status codes from live API requests against the running backend.

| Page / Action ID | Route | Primary API Endpoint | Anonymous | Owner | Admin | Member | Project PM | Contributor | Viewer | Client Reviewer |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `main` | `/` | `n/a` | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| `pricing` | `/pricing` | `n/a` | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| `login` | `/login` | `/identity/login` | 403 | 400 | 400 | 400 | n/a | n/a | n/a | 400 |
| `register` | `/register` | `/identity/register` | 403 | 400 | 400 | 400 | n/a | n/a | n/a | 400 |
| `forgot-password` | `/forgot-password` | `/identity/recovery` | 403 | 400 | 400 | 400 | n/a | n/a | n/a | 400 |
| `reset-password` | `/reset-password` | `/identity/reset` | 403 | 400 | 400 | 400 | n/a | n/a | n/a | 400 |
| `404` | `/404` | `n/a` | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| `loading` | `/loading` | `n/a` | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| `onboarding` | `/onboarding` | `/me` | 401 | 200 | 200 | 200 | n/a | n/a | n/a | 200 |
| `invitation` | `/invitation` | `/me` | 401 | 200 | 200 | 200 | n/a | n/a | n/a | 200 |
| `workspace-account` | `/workspace/account` | `/me` | 401 | 200 | 200 | 200 | n/a | n/a | n/a | 200 |
| `account-sessions` | `/workspace/account#sessions` | `/me/sessions` | 401 | 200 | 200 | 200 | n/a | n/a | n/a | 200 |
| `portal-portal-account` | `/portal/portal-account` | `/me` | 401 | 200 | 200 | 200 | n/a | n/a | n/a | 200 |
| `workspace-dashboard` | `/workspace/dashboard` | `/organizations/{organizationId}/dashboard` | 401 | 200 | 200 | 200 | n/a | n/a | n/a | 404 |
| `workspace-projects` | `/workspace/projects` | `/organizations/{organizationId}/projects` | 401 | 200 | 200 | 200 | n/a | n/a | n/a | 404 |
| `workspace-my-tasks` | `/workspace/my-tasks` | `/organizations/{organizationId}/my-tasks` | 401 | 200 | 200 | 200 | n/a | n/a | n/a | 404 |
| `workspace-clients` | `/workspace/clients` | `/organizations/{organizationId}/clients` | 401 | 200 | 200 | 200 | n/a | n/a | n/a | 404 |
| `workspace-client` | `/workspace/client` | `/organizations/{organizationId}/clients/{resourceId}` | 401 | 200 | 200 | 404 | n/a | n/a | n/a | 404 |
| `workspace-reviews` | `/workspace/reviews` | `/organizations/{organizationId}/reviews` | 401 | 200 | 200 | 200 | n/a | n/a | n/a | 404 |
| `workspace-documents` | `/workspace/documents` | `/organizations/{organizationId}/documents` | 401 | 200 | 200 | 200 | n/a | n/a | n/a | 404 |
| `workspace-document` | `/workspace/document` | `/organizations/{organizationId}/documents/{resourceId}` | 401 | 200 | 200 | 200 | 200 | 200 | 200 | 404 |
| `workspace-reports` | `/workspace/reports` | `/organizations/{organizationId}/reports` | 401 | 200 | 200 | 200 | n/a | n/a | n/a | 404 |
| `workspace-notifications` | `/workspace/notifications` | `/organizations/{organizationId}/notifications` | 401 | 200 | 200 | 200 | n/a | n/a | n/a | 404 |
| `workspace-settings` | `/workspace/settings` | `/organizations/{organizationId}` | 401 | 200 | 200 | 200 | n/a | n/a | n/a | 404 |
| `workspace-team` | `/workspace/team` | `/organizations/{organizationId}/team` | 401 | 200 | 200 | 403 | n/a | n/a | n/a | 404 |
| `team-invitations` | `/workspace/team#invites` | `/organizations/{organizationId}/invitations` | 401 | 200 | 200 | 403 | n/a | n/a | n/a | 404 |
| `workspace-audit` | `/workspace/audit` | `/organizations/{organizationId}/audit` | 401 | 200 | 200 | 403 | n/a | n/a | n/a | 404 |
| `project-project` | `/project/project` | `/organizations/{organizationId}/projects/{projectId}` | 401 | 200 | 200 | 404 | 200 | 200 | 200 | 404 |
| `project-project-tasks` | `/project/project-tasks` | `/organizations/{organizationId}/projects/{projectId}/tasks` | 401 | 200 | 200 | 404 | 200 | 200 | 200 | 404 |
| `project-project-task` | `/project/project-task` | `/organizations/{organizationId}/projects/{projectId}/tasks` | 401 | 200 | 200 | 404 | 200 | 200 | 200 | 404 |
| `project-project-milestones` | `/project/project-milestones` | `/organizations/{organizationId}/projects/{projectId}/milestones` | 401 | 200 | 200 | 404 | 200 | 200 | 200 | 404 |
| `project-project-files` | `/project/project-files` | `/organizations/{organizationId}/projects/{projectId}/deliverables` | 401 | 200 | 200 | 404 | 200 | 200 | 200 | 404 |
| `project-project-deliverables` | `/project/project-deliverables` | `/organizations/{organizationId}/projects/{projectId}/deliverables` | 401 | 200 | 200 | 404 | 200 | 200 | 200 | 404 |
| `project-project-access` | `/project/project-access` | `/organizations/{organizationId}/projects/{projectId}/members` | 401 | 200 | 200 | 404 | 200 | 200 | 200 | 404 |
| `project-grants` | `/project/project-access#clients` | `/organizations/{organizationId}/projects/{projectId}/grants` | 401 | 200 | 200 | 404 | 200 | 200 | 200 | 404 |
| `project-project-discussions` | `/project/project-discussions` | `/organizations/{organizationId}/projects/{projectId}/discussions` | 401 | 200 | 200 | 404 | 200 | 200 | 200 | 404 |
| `project-project-activity` | `/project/project-activity` | `/organizations/{organizationId}/projects/{projectId}/activity` | 401 | 200 | 200 | 404 | 200 | 200 | 200 | 404 |
| `project-project-review` | `/project/project-review` | `/organizations/{organizationId}/projects/{projectId}/reviews` | 401 | 200 | 200 | 404 | 200 | 200 | 200 | 404 |
| `portal-portal-projects` | `/portal/portal-projects` | `/organizations/{organizationId}/portal/projects` | 401 | 404 | 404 | 404 | n/a | n/a | n/a | 200 |
| `portal-portal-project` | `/portal/portal-project` | `/organizations/{organizationId}/portal/projects/{projectId}` | 401 | 404 | 404 | 404 | n/a | n/a | n/a | 200 |
| `portal-portal-deliverables` | `/portal/portal-deliverables` | `/organizations/{organizationId}/portal/deliverables` | 401 | 404 | 404 | 404 | n/a | n/a | n/a | 404 |
| `portal-portal-review` | `/portal/portal-review` | `/organizations/{organizationId}/portal/reviews` | 401 | 404 | 404 | 404 | n/a | n/a | n/a | 200 |
| `portal-portal-updates` | `/portal/portal-updates` | `/organizations/{organizationId}/portal/updates` | 401 | 404 | 404 | 404 | n/a | n/a | n/a | 200 |
| `portal-portal-notifications` | `/portal/portal-notifications` | `/organizations/{organizationId}/portal/notifications` | 401 | 404 | 404 | 404 | n/a | n/a | n/a | 200 |
| `mutation:settings-patch-member` | `PATCH /organizations/{id}` | `/organizations/{organizationId}` | 403 | 200 | 200 | 403 | n/a | n/a | n/a | 404 |
| `mutation:settings-patch-admin` | `PATCH /organizations/{id}` | `/organizations/{organizationId}` | 403 | 200 | 200 | 403 | n/a | n/a | n/a | 404 |
| `mutation:team-patch-admin` | `PATCH /organizations/{id}/team/{id}` | `/organizations/{organizationId}/team/{membershipId}` | 403 | 409 | 403 | 403 | n/a | n/a | n/a | 404 |
| `mutation:invitations-post-member` | `POST /organizations/{id}/invitations` | `/organizations/{organizationId}/invitations` | 403 | 201 | 409 | 403 | n/a | n/a | n/a | 404 |
| `mutation:project-access-get-contrib` | `GET /projects/{id}/access` | `/organizations/{organizationId}/projects/{projectId}/members` | 401 | 200 | 200 | 404 | 200 | 200 | 200 | 404 |
| `mutation:project-access-post-contrib` | `POST /projects/{id}/access/team` | `/organizations/{organizationId}/projects/{projectId}/members` | 403 | 201 | 409 | 403 | 409 | 403 | 403 | 404 |

## Notes & Verification Rules

1. **Operations.ts Policy Categories vs Domain Roles**:
   - At the route/OpenAPI layer in `operations.ts`, authorization policies are categorized into: `'public'`, `'self'`, `'internal'`, `'admin'`, `'owner'`, and `'client'`.
   - `operations.ts` does not contain distinct `VIEWER` or `CONTRIBUTOR` route-level policies; instead, all project endpoints are tagged `'internal'`.
   - The contract role enum in `packages/contracts/src/phase3.ts` defines project roles as `['MANAGER', 'CONTRIBUTOR', 'VIEWER']`. Domain logic in `core.ts` and `expansion.ts` enforces these roles:
     - `MANAGER`: Full access; can manage team access, client grants, and execute terminal actions (archive).
     - `CONTRIBUTOR`: Read/write access on tasks, checklists, and discussions; cannot manage access or execute terminal actions.
     - `VIEWER`: Read-only access across all project endpoints. Any mutation returns `403 FORBIDDEN` (`"This action requires project management permission"`).
2. **Pure HTTP Status Codes**: Every cell contains only measured status codes (`200`, `201`, `400`, `401`, `403`, `404`), `n/a`, or `unverified`.
3. **Self-Scope Pages**: Probed without active organization principal headers. `/me` returns `200` for any authenticated user including Client Contacts.
4. **Mutation Enforcement**:
   - `PATCH /organizations/{organizationId}`: Returns `403` for Member, `200` for Admin.
   - `PATCH /organizations/{organizationId}/team/{membershipId}` (Admin demoting Owner): Returns `403` (`OWNER_REQUIRED`). Changing an owner's role requires re-authentication (`403 REAUTHENTICATE`).
   - `POST /organizations/{organizationId}/invitations`: Accepts `ADMIN` or `MEMBER` only. Returns `403` for Member, `201` for Admin/Owner.
   - `POST /organizations/{organizationId}/projects/{projectId}/members`: Returns `403` for Contributor and Viewer.
   - Sole Manager Protection: Demoting or removing the only `MANAGER` on a project is prevented by UI validation (`"A project needs at least one manager. Make someone else a manager first."`).
   - Terminal Discussion Archiving: `POST /organizations/{organizationId}/projects/{projectId}/discussions/{discussionId}/archive` requires `MANAGER` role and confirmation; locks discussion as read-only.
   - Project Activity: `GET /organizations/{organizationId}/projects/{projectId}/activity` returns `200` for MANAGER, CONTRIBUTOR, and VIEWER. Server supports `limit`, `cursor`, `from`, `to`, and `action` filters.
