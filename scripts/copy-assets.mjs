import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();

await fs.copyFile(path.join(root, 'src', 'style.css'), path.join(root, 'dist', 'style.css'));

