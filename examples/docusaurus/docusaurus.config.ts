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
};

export default config;
