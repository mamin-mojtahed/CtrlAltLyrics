import React from 'react';
import ReactDOM from 'react-dom/client';
import DashboardApp from './DashboardApp';

const container = document.getElementById('root') || document.getElementById('app') || document.body;
const root = ReactDOM.createRoot(container);
root.render(<DashboardApp />);
