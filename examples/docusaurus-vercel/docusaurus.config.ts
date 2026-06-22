import type {Config} from '@docusaurus/types';

const config: Config = {
  title: 'Gemini Search Example',
  tagline: 'Docusaurus Gemini Search example',
  url: 'https://example.com',
  baseUrl: '/',
  favicon: 'img/favicon.ico',
  organizationName: 'example',
  projectName: 'gemini-search-example',
  onBrokenLinks: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },
  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
        },
        blog: false,
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
