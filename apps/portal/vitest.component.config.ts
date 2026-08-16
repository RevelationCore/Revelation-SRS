import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], define: { 'import.meta.env.VITE_DEMO_MODE': '"true"' }, test: { environment: 'jsdom', setupFiles: ['../../test/component-setup.mjs'], include: ['test/**/*.component.test.tsx'] } });
