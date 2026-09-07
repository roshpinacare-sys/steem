import React from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 48 }}>
      <h1>ECOS V225 starter</h1>
      <p>Built by an agent. Edit <code>src/main.jsx</code> to begin.</p>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
