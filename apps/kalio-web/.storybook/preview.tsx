import type { Preview } from '@storybook/react-vite';
import '../src/index.css';

document.documentElement.setAttribute('data-theme', 'dark');

if (!('clipboard' in navigator)) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async () => undefined,
    },
  });
}

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: 'Kalio dark',
      values: [{ name: 'Kalio dark', value: '#0f172a' }],
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-base-100 p-6 text-base-content">
        <Story />
      </div>
    ),
  ],
};

export default preview;
