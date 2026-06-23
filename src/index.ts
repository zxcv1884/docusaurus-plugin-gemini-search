import type {LoadContext, Plugin} from '@docusaurus/types';
import {syncGeminiSearch, type SyncOptions} from './sync.js';

export type GeminiSearchPluginOptions = Omit<SyncOptions, 'rootDir' | 'dryRun' | 'createStore' | 'client'> & {
  syncOnBuild?: boolean;
};

export default function geminiSearchPlugin(
  context: LoadContext,
  _options: GeminiSearchPluginOptions = {},
): Plugin<void> {
  return {
    name: 'docusaurus-plugin-gemini-search',
    async postBuild() {
      if (!_options.syncOnBuild) {
        return;
      }

      await syncGeminiSearch({
        ..._options,
        rootDir: context.siteDir,
      });
    },
  };
}
