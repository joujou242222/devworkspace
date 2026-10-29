import { requireAccount } from '../../../auth';
import CoreWorkspace from '../../../core';
import ReviewWorkspace from '../../../reviews';
import ExpansionWorkspace from '../../../expansion';
export const dynamic = 'force-dynamic';
export default async function Page({
  params,
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  params: Promise<{ orgId: string; core?: string[] }>;
}) {
  const { orgId, core = [] } = await params;
  await requireAccount(`/w/${orgId}/${core.join('/')}`, await searchParams);
  if (
    ['reports', 'documents', 'audit'].includes(core[0] ?? '') ||
    ['discussions', 'documents', 'activity'].includes(core[2] ?? '')
  )
    return <ExpansionWorkspace key={orgId + core.join('/')} orgId={orgId} segments={core} />;
  if (core[0] === 'reviews' || core[0] === 'notifications' || core[2] === 'reviews')
    return <ReviewWorkspace key={orgId + core.join('/')} orgId={orgId} segments={core} />;
  return <CoreWorkspace key={orgId + core.join('/')} orgId={orgId} segments={core} />;
}
