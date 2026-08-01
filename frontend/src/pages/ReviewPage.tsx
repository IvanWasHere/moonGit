import { ReviewView } from '@/layouts/ReviewView';
import { Workspace } from '@/layouts/Workspace';

/** Review View — Repositories / Files / Commit Messages over Origin Branch / Changes. */
export function ReviewPage() {
  return (
    <Workspace view="review">
      <ReviewView />
    </Workspace>
  );
}
