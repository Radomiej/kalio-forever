import type { StorybookConfig } from '@storybook/react-vite';
import { mergeConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const configDir = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(configDir, '..');

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  viteFinal: async (config) => mergeConfig(config, {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@': resolve(webRoot, 'src'),
        '@kalio/types': resolve(webRoot, '../../packages/@kalio/types/src'),
        '@kalio/sdk': resolve(webRoot, '../../packages/@kalio/sdk/src'),
      },
    },
  }),
};

export default config;
