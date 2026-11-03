import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './workbench';
import './styles.css';
import './workbench-design.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
