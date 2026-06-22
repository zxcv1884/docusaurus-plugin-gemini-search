import type {LoadContext, Plugin} from '@docusaurus/types';

export type GeminiSearchPluginOptions = Record<string, unknown>;

export default function geminiSearchPlugin(
  _context: LoadContext,
  _options: GeminiSearchPluginOptions = {},
): Plugin<void> {
  return {
    name: 'docusaurus-plugin-gemini-search',
  };
}
