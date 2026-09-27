"use client";
import { useEffect, useState } from "react";
import { createRuntime } from "akarisp";

// Ownership (spec 010): create on mount, shut down on unmount, including a runtime
// whose creation resolves after unmount (fixed pattern, T015).
export default function Owner() {
  const [runtime, setRuntime] = useState(null);
  const [out, setOut] = useState("");

  useEffect(() => {
    let rt;
    let cancelled = false; // set by cleanup; a runtime resolving afterwards is shut down at once
    createRuntime().then((r) => {
      console.info("akarisp:create");
      if (cancelled) {
        r.shutdown().then(() => console.info("akarisp:shutdown"));
        return;
      }
      rt = r;
      setRuntime(r);
    });
    return () => {
      cancelled = true;
      rt?.shutdown().then(() => console.info("akarisp:shutdown"));
    };
  }, []);

  async function run() {
    const { output } = await runtime.run("hi");
    setOut((o) => o + output);
  }

  async function stream() {
    try {
      for await (const chunk of runtime.stream("hi")) setOut((o) => o + chunk);
    } catch {} // cancelled by unmount/shutdown
  }

  return (
    <div>
      <button id="run" onClick={run}>
        run
      </button>
      <button id="stream" onClick={stream}>
        stream
      </button>
      <span id="state">{runtime?.state ?? "none"}</span>
      <pre id="out">{out}</pre>
    </div>
  );
}
