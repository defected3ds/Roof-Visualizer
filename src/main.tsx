import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Admin from './admin/Admin';
import App from './App';
import './index.css';
import { installSessionHeaders } from './lib/session';

if (window.location.pathname.replace(/\/+$/, '') !== '/admin') installSessionHeaders();
const isAdmin = window.location.pathname.replace(/\/+$/, '') === '/admin';

createRoot(document.getElementById('root')!).render(<StrictMode>{isAdmin ? <Admin /> : <App />}</StrictMode>);
