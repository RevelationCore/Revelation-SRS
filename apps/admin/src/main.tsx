import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { CodeSetProvider } from '@revelation-srs/ui';

import { AuthProvider } from './auth/AuthContext.js';
import { loadCodes } from './codes.js';
import { App } from './App.js';
import './i18n.js';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <CodeSetProvider load={loadCodes}>
          <App />
        </CodeSetProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
