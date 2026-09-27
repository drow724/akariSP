// Test-only stand-in for the browser's LanguageModel global (spec 010, fixture contract).
// Injected by e2e-frameworks before any application code; never imported by a fixture.
(() => {
  const c = (globalThis.__akari = { creates: 0, destroys: 0, clones: 0, cloneDestroys: 0, hold: false, createDelay: 0 });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const task = () => ({
    async prompt() { return 'ok'; },
    async *promptStreaming(_input, { signal } = {}) {
      for (const chunk of ['a', 'b']) {
        if (signal?.aborted) throw signal.reason;
        yield chunk;
      }
      while (c.hold) {
        if (signal?.aborted) throw signal.reason;
        await sleep(10);
      }
      if (signal?.aborted) throw signal.reason;
    },
    destroy() { c.cloneDestroys++; },
  });
  globalThis.LanguageModel = {
    async create() {
      c.creates++;
      if (c.createDelay) await sleep(c.createDelay); // lets a test unmount while creation is pending
      return {
        async clone({ signal } = {}) {
          if (signal?.aborted) throw signal.reason;
          c.clones++;
          return task();
        },
        destroy() { c.destroys++; },
      };
    },
  };
})();
