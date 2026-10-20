import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { createHttpRoundEvaluator } from './services/roundApi';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

const roundEvaluator = createHttpRoundEvaluator();

createRoot(container).render(
  <StrictMode>
    <App roundEvaluator={roundEvaluator} />
  </StrictMode>,
);
