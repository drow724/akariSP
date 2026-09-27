import { defineConfig } from '@playwright/test';

// Layer 2 (spec 006): harness and import-safety checks on 3 engines. Engine results are never
// branded-browser evidence (WebKit ≠ Safari) and never replace real-model lifecycle runs.
export default defineConfig({
  testDir: 'e2e',
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  use: { baseURL: 'http://localhost:8080' },
  webServer: {
    command: 'npm run build && python3 -m http.server 8080',
    url: 'http://localhost:8080/smoke/streaming.html',
    reuseExistingServer: true,
  },
});
