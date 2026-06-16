import { StrictMode } from 'react';import { createRoot } from 'react-dom/client';import App from './App';import { AppProvider } from './context/AppContext';import './styles.css';
(globalThis as typeof globalThis & { __CBM_APP_STARTED__?: boolean }).__CBM_APP_STARTED__ = true;
createRoot(document.getElementById('root')!).render(<StrictMode><AppProvider><App/></AppProvider></StrictMode>);
