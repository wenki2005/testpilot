import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './workbench';

const difyPage = ['dify-regression', 'module-regression', 'case-scripts', 'run-reports'].includes(new URLSearchParams(window.location.search).get('page') ?? '');
if (difyPage) {
  await import('./dify-workbench-base.css');
} else {
  await import('./styles.css');
  await import('./workbench-design.css');
  await import('./shared-sidebar.css');
}
await import('./approved-sidebar.css');

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
