import { MainView } from '@/layouts/MainView';
import { Workspace } from '@/layouts/Workspace';

/** Main View — Repositories / Branches beside Files / Changes / Journal. */
export function MainPage() {
  return (
    <Workspace view="main">
      <MainView />
    </Workspace>
  );
}
