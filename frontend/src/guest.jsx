import React from 'react';
import ReactDOM from 'react-dom/client';
import GuestApp from './GuestApp';
import ErrorBoundary from './components/common/ErrorBoundary';

const container = document.getElementById('root') || document.body;
const root = ReactDOM.createRoot(container);
root.render(
  <ErrorBoundary>
    <GuestApp />
  </ErrorBoundary>
);
