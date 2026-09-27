import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Owner from './Owner.jsx';

function App() {
  const [mounted, setMounted] = useState(true);
  return (
    <>
      <button id="toggle" onClick={() => setMounted((m) => !m)}>toggle</button>
      {mounted && <Owner />}
    </>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
