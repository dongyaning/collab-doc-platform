import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app';
import { setupMonitor } from './lib/monitor';
import './styles/variables.less';
import './styles/global.css';

setupMonitor();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
