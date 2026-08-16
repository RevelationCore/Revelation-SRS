import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'jsdom', setupFiles: ['../../test/component-setup.mjs'], include: ['test/**/*.component.test.tsx'] } });
