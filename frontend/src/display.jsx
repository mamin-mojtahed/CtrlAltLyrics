import React from 'react';
import ReactDOM from 'react-dom/client';
import DisplayApp from './DisplayApp';
import ErrorBoundary from './components/common/ErrorBoundary';

const container = document.getElementById('root') || document.body;
const root = ReactDOM.createRoot(container);
root.render(
  <ErrorBoundary>
    <DisplayApp />
  </ErrorBoundary>
);
