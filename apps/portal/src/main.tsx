import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext.js';
import { Codes } from './codes.js';
import { App } from './App.js';
import './i18n.js';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Codes>
          <App />
        </Codes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
