import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { App } from './App';

// Set dark theme globally
document.documentElement.setAttribute('data-theme', 'dark');

const root = document.getElementById('root');
if (!root) throw new Error('#root element not found');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
