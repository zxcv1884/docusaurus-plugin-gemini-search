import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {LoadContext, Plugin} from '@docusaurus/types';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export type GeminiSearchPluginOptions = {
  routePath?: string;
  apiPath?: string;
  title?: string;
  subtitle?: string;
  placeholder?: string;
  suggestions?: Array<{
    label?: string;
    question: string;
  }>;
  turnstileSiteKey?: string;
  turnstileAction?: string;
};

export default function geminiSearchPlugin(
  _context: LoadContext,
  options: GeminiSearchPluginOptions = {},
): Plugin<void> {
  const routePath = normalizeRoutePath(options.routePath || '/ask-ai');

  return {
    name: 'docusaurus-plugin-gemini-search',

    async contentLoaded({actions}) {
      const {addRoute, createData} = actions;
      const configPath = await createData(
        'gemini-search-config.json',
        JSON.stringify(normalizeClientOptions(options), null, 2),
      );

      addRoute({
        path: routePath,
        component: '@theme/GeminiSearchPage',
        modules: {
          config: configPath,
        },
        exact: true,
      });
    },

    getThemePath() {
      return path.join(dirname, 'theme');
    },

    getClientModules() {
      return [path.join(dirname, 'style.css')];
    },
  };
}

function normalizeClientOptions(options: GeminiSearchPluginOptions) {
  return {
    apiPath: options.apiPath || '/api/gemini-search',
    title: options.title || 'Ask AI',
    subtitle: options.subtitle || 'Ask a question about this documentation.',
    placeholder: options.placeholder || 'Ask about these docs...',
    suggestions: options.suggestions || [],
    turnstileSiteKey: options.turnstileSiteKey || '',
    turnstileAction: options.turnstileAction || 'gemini_search',
  };
}

function normalizeRoutePath(routePath: string) {
  const trimmed = routePath.trim();
  if (!trimmed || trimmed === '/') {
    return '/ask-ai';
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}
