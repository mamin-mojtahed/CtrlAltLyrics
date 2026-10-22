import React from 'react';
import ReactDOM from 'react-dom/client';
import DisplayApp from './DisplayApp';

const container = document.getElementById('root') || document.body;
const root = ReactDOM.createRoot(container);
root.render(<DisplayApp />);
