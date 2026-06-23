import process from 'node:process';
import {startGeminiSearchPreview} from './preview.js';
import {syncGeminiSearch, type SyncSource} from './sync.js';

export type ParsedArgs = {
  flags: Set<string>;
  values: Map<string, string[]>;
};

export function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Set<string>();
  const values = new Map<string, string[]>();

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      const current = values.get(arg) || [];
      current.push(next);
      values.set(arg, current);
      index++;
    } else {
      flags.add(arg);
    }
  }

  return {flags, values};
}

export function getArgValue(args: ParsedArgs, name: string) {
  return args.values.get(name)?.at(-1);
}

export function parseSyncSources(values: string[] = []): SyncSource[] | undefined {
  if (!values.length) {
    return undefined;
  }

  return values.map((value) => {
    const parts = value.split(',').map((part) => part.trim());
    const [dir, basePathname, section] = parts;
    if (parts.length < 2 || parts.length > 3 || !dir || !basePathname) {
      throw new Error('--source must use <dir>,<basePathname>[,<section>].');
    }

    return {
      dir,
      basePathname,
      ...(section ? {section} : {}),
    };
  });
}

export async function runCli(argv = process.argv.slice(2)) {
  const command = argv[0] || 'help';
  const args = parseArgs(argv.slice(1));

  if (command === 'sync') {
    await syncGeminiSearch({
      dryRun: args.flags.has('--dry-run'),
      docsDir: getArgValue(args, '--docs-dir'),
      basePathname: getArgValue(args, '--base-pathname'),
      sources: parseSyncSources(args.values.get('--source')),
      siteUrl: getArgValue(args, '--site-url'),
      storeName: getArgValue(args, '--store-name'),
      concurrency: parsePositiveInteger(getArgValue(args, '--concurrency')),
    });
  } else if (command === 'create-store') {
    await syncGeminiSearch({createStore: true});
  } else if (command === 'preview') {
    await startGeminiSearchPreview({
      apiPath: getArgValue(args, '--api-path'),
      siteDir: getArgValue(args, '--site-dir'),
      host: getArgValue(args, '--host'),
      port: parsePositiveInteger(getArgValue(args, '--port')),
      allowedOrigins: args.values.get('--allowed-origin'),
      stream: args.flags.has('--stream'),
    });
  } else if (command === 'doctor') {
    printDoctor();
  } else {
    printHelp();
  }
}

export function getHelpText() {
  return `gemini-search

Commands:
  gemini-search sync [options]        Upload docs to Gemini File Search
    --dry-run                         Preview without uploading
    --docs-dir <path>                 Docs directory (default: docs)
    --base-pathname <path>            URL base path for --docs-dir (default: /docs)
    --source <dir>,<base>[,<section>] Docs source; repeatable; overrides --docs-dir
    --site-url <url>                  Site URL override
    --store-name <name>               Store name override
    --concurrency <n>                 Parallel uploads, clamped to 1-8 (default: 4)
  gemini-search create-store          Create a Gemini File Search store
  gemini-search preview [options]     Serve a Docusaurus build with the Gemini Search API
    --api-path <path>                 API route path (default: /api/gemini-search)
    --site-dir <path>                 Docusaurus build directory (default: build)
    --host <host>                     Hostname to bind (default: 127.0.0.1)
    --port <n>                        Port to bind (default: 3021)
    --allowed-origin <origin>         Extra CORS origin; repeatable
    --stream                          Stream successful answers as Server-Sent Events
  gemini-search doctor                Check required environment variables
`;
}

function parsePositiveInteger(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

export function printHelp() {
  console.log(getHelpText());
}

export function printDoctor() {
  const checks = [
    ['GEMINI_API_KEY', Boolean(process.env.GEMINI_API_KEY)],
    ['GEMINI_FILE_SEARCH_STORE_NAME', Boolean(process.env.GEMINI_FILE_SEARCH_STORE_NAME)],
    ['GEMINI_SEARCH_SITE_URL', Boolean(process.env.GEMINI_SEARCH_SITE_URL)],
  ];

  for (const [label, ok] of checks) {
    console.log(`${ok ? 'OK  ' : 'MISS'} ${label}`);
  }
}
