'use client';

/** Ordinary full navigations deliberately discard the previous resource/capacity state. */
export function WorkspaceNavigation({ orgId, role }: { orgId: string; role?: string | undefined }) {
  const root = `/w/${orgId}`;
  return (
    <nav aria-label="Workspace">
      <a href={root}>Dashboard</a> <a href={root + '/projects'}>Projects</a>
      <a href={root + '/my-tasks'}>My Tasks</a> <a href={root + '/clients'}>Clients</a>
      {role !== 'MEMBER' && <a href={root + '/team'}>Team</a>}
      <a href={root + '/settings'}>Settings</a> <a href={root + '/reviews'}>Review Center</a>
      <a href={root + '/reports'}>Reports</a> <a href={root + '/documents'}>Documents</a>
      {role !== 'MEMBER' && <a href={root + '/audit'}>Audit log</a>}
    </nav>
  );
}

export function ProjectNavigation({
  orgId,
  projectId,
  client = false,
}: {
  orgId: string;
  projectId: string;
  client?: boolean;
}) {
  const root = `${client ? '/portal' : '/w'}/${orgId}`;
  const project = `${root}/projects/${projectId}`;
  return (
    <nav aria-label="Project">
      <a href={project}>Overview</a>
      {!client && (
        <>
          <a href={project + '/tasks'}>Tasks</a>
          <a href={project + '/milestones'}>Milestones</a>
          <a href={project + '/access'}>Team & access</a>
          <a href={project + '/files'}>Files</a>
          <a href={project + '/deliverables'}>Deliverables</a>
        </>
      )}
      <a href={project + '/reviews'}>Reviews</a>
      {client ? (
        <a href={root + '/updates?projectId=' + projectId}>Client updates</a>
      ) : (
        <>
          <a href={project + '/discussions'}>Discussions</a>
          <a href={project + '/activity'}>Activity</a>
          <a href={root + '/documents?projectId=' + projectId}>Documents</a>
        </>
      )}
    </nav>
  );
}

export function capacityKey(orgId: string, client: boolean) {
  return `devworkspace:capacity:${client ? 'client' : 'internal'}:${orgId}`;
}

export function preferredCapacity<T extends { id: string }>(
  items: T[],
  orgId: string,
  client: boolean,
) {
  const selected = sessionStorage.getItem(capacityKey(orgId, client));
  return items.find((p) => p.id === selected) ?? items[0];
}
