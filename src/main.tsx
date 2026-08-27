import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { ThemeProvider } from './theme/ThemeProvider';
import { bootstrap } from './data/bootstrap';
import App from './App';
import './app.css';

// Seeding the catalog before first paint keeps every screen's empty state
// meaningful rather than briefly showing "no species known".
bootstrap().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ThemeProvider>
        {/* HashRouter so an installed PWA needs no server rewrite rules. */}
        <HashRouter>
          <App />
        </HashRouter>
      </ThemeProvider>
    </StrictMode>,
  );
});
