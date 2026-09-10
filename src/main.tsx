import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
// Registers the market data providers before any component asks for data.
import './services/providers';
import { App } from './App';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
