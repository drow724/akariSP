'use client';
import { useState } from 'react';
import Owner from './owner.jsx';

export default function Toggle() {
  const [mounted, setMounted] = useState(true);
  return (
    <>
      <button id="toggle" onClick={() => setMounted((m) => !m)}>toggle</button>
      {mounted && <Owner />}
    </>
  );
}
