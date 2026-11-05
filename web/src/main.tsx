import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/workbench';

const difyPage = ['dify-regression', 'module-regression', 'case-scripts', 'run-reports'].includes(new URLSearchParams(window.location.search).get('page') ?? '');
if (difyPage) {
  await import('./app/styles/execution-base.css');
} else {
  await import('./app/styles/base.css');
  await import('./app/styles/workbench.css');
  await import('./app/styles/sidebar-shared.css');
}
await import('./app/styles/sidebar.css');

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
