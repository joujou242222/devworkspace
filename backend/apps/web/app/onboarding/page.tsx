import { requireAccount } from '../auth';
import Flow from '../flows';
export const dynamic = 'force-dynamic';
export default async function Page() {
  await requireAccount('/onboarding');
  return <Flow mode="onboarding" />;
}
