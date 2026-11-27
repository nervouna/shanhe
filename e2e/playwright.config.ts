import path from 'node:path';
import { defineConfig } from '@playwright/test';

/** An unusual port, so that a run never meets another project's server. */
const PORT = 4406;
const root = path.resolve(import.meta.dirname, '..');

/**
 * Extra Chromium flags, separated by spaces, for trying another graphics
 * backend by hand, for example `SHANHE_CHROMIUM_ARGS="--enable-unsafe-webgpu"`.
 */
const extraArgs = (process.env.SHANHE_CHROMIUM_ARGS ?? '').split(' ').filter((arg) => arg !== '');

export default defineConfig({
  testDir: '.',
  outputDir: '.output',
  reporter: 'list',
  forbidOnly: true,
  workers: 1,
  // software rendering on CI is slow
  timeout: 180_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    browserName: 'chromium',
    headless: true,
    // small enough for software rendering to keep up
    viewport: { width: 960, height: 540 },
    launchOptions: {
      // lets Chromium fall back to software WebGL where there is no GPU
      args: ['--enable-unsafe-swiftshader', ...extraArgs],
    },
  },
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    cwd: root,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
