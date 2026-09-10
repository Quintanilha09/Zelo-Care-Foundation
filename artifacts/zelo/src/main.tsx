import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';
import { temaGuardado, observarOAparelho } from '@/lib/tema';

import './index.css';

/**
 * Issue #138 — o app segue o modo noturno do aparelho enquanto está aberto.
 *
 * A classe já foi aplicada antes da primeira pintura pelo script inline do
 * `index.html`; isto cobre o que acontece **depois**: o modo noturno agendado
 * do celular troca no fim da tarde, com o app na tela. Sem este observador a
 * troca só valeria na próxima abertura.
 *
 * Fica aqui, e não num componente: é uma assinatura por aba, e o componente
 * de Ajustes pode nem chegar a ser montado.
 */
observarOAparelho(temaGuardado);

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
