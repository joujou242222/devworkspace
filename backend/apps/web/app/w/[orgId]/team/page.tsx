import { requireAccount } from '../../../auth';
import Flow from '../../../flows';
export const dynamic = 'force-dynamic';
export default async function Page({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  await requireAccount(`/w/${orgId}/team`);
  return <Flow key={orgId} mode="team" orgId={orgId} />;
}
