import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { createQueryClient } from './api/queryClient';
import { ToastProvider } from './components/Toasts';
import './styles/panel.css';
import { MOBILE_PREVIEW } from './mobilePreview';
import './styles/mobile-preview.css';

const queryClient = createQueryClient();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('falta #root');

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter basename={MOBILE_PREVIEW ? '/prueba-movil' : undefined}>
          <App />
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
