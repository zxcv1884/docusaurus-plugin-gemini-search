import type {Config} from '@docusaurus/types';

const config: Config = {
  title: 'Gemini Search Example',
  url: 'https://example.com',
  baseUrl: '/',
  favicon: 'img/favicon.ico',
  organizationName: 'example',
  projectName: 'gemini-search-example',
  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
        },
      },
    ],
  ],
  plugins: [
    [
      'docusaurus-plugin-gemini-search',
      {
        routePath: '/ask-ai',
        apiPath: '/api/gemini-search',
        title: 'Ask AI',
        subtitle: 'Ask this documentation a question.',
        suggestions: [
          {
            label: 'Docs',
            question: 'What can I find in these docs?',
          },
        ],
      },
    ],
  ],
};

export default config;

