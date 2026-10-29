import { requireAccount } from '../../../auth';
import ReviewWorkspace from '../../../reviews';
import ExpansionWorkspace from '../../../expansion';
export const dynamic = 'force-dynamic';
export default async function Page({
  params,
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  params: Promise<{ orgId: string; review?: string[] }>;
}) {
  const { orgId, review = [] } = await params;
  await requireAccount(`/portal/${orgId}/${review.join('/')}`, await searchParams);
  if (review[0] === 'updates')
    return <ExpansionWorkspace key={orgId + 'updates'} orgId={orgId} segments={review} client />;
  return <ReviewWorkspace key={orgId + review.join('/')} orgId={orgId} segments={review} client />;
}
