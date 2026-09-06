import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
export default defineConfig({ base: '/resource-availability', integrations: [react()], output: 'static', outDir: '../resource-availability' });
