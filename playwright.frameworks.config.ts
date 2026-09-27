import { defineConfig } from '@playwright/test';

// Spec 010: framework fixtures installed from the npm registry, production builds, Chromium,
// stand-in LanguageModel. Separate from playwright.config.ts (spec 006, `test:browser`).
// Playwright starts every webServer regardless of -g, so each fixture adds its own entry.
const vite = (id: string, port: number) => ({
  cwd: `fixtures/${id}`,
  command: `npm ci --no-audit --no-fund && npm run build && npm run preview -- --port ${port} --strictPort`,
  url: `http://localhost:${port}`,
  reuseExistingServer: false,
  timeout: 300_000,
});

export default defineConfig({
  testDir: 'e2e-frameworks',
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: [
    vite('react-vite', 5173),
    vite('vue-vite', 5174),
    vite('svelte-vite', 5175),
    {
      cwd: 'fixtures/next',
      // Server output goes to server.log so the spec can read server-side errors (M1).
      command: 'npm ci --no-audit --no-fund && npm run build && npm run start -- -p 5176 > server.log 2>&1',
      url: 'http://localhost:5176',
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
});
