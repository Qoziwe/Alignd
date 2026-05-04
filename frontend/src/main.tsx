import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import AdminPanel from './AdminPanel.tsx';
import App from './App.tsx';
import './index.css';

const RootComponent = window.location.pathname.startsWith('/adminpanel') ? AdminPanel : App;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootComponent />
  </StrictMode>,
);

requestAnimationFrame(() => {
  document.getElementById('site-preloader')?.remove();
});
