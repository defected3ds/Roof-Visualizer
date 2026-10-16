import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Admin from './admin/Admin';
import App from './App';
import './index.css';

const isAdmin = window.location.pathname.replace(/\/+$/, '') === '/admin';

createRoot(document.getElementById('root')!).render(<StrictMode>{isAdmin ? <Admin /> : <App />}</StrictMode>);
