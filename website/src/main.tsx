import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, AppErrorBoundary } from './App';
import { PreferencesProvider } from './lib/PreferencesProvider';
import './styles/tokens.css';
import './styles/base.css';
import './styles/preferences.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <PreferencesProvider>
        <App />
      </PreferencesProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
