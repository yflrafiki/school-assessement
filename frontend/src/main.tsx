import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { Providers } from './app/providers';
import { router } from './app/router';
import { settleTabSession } from './lib/tabSession';
import { isInstalledApp, registerServiceWorker, watchInstallOffer } from './lib/installedApp';
import './styles/index.css';

watchInstallOffer();
registerServiceWorker();

// A duplicated browser tab must get its own session before it makes any request with the
// shared one. The installed app has no tabs, so it skips this.
void (isInstalledApp() ? Promise.resolve() : settleTabSession()).finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Providers>
        <RouterProvider router={router} />
      </Providers>
    </StrictMode>,
  );
});
