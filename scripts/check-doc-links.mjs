import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const scanRoots = [
  'README.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'SECURITY.md',
  'docs',
];
const markdownFiles = [];
const errors = [];

function collect(path) {
  if (!existsSync(path)) return;
  if (statSync(path).isDirectory()) {
    for (const name of readdirSync(path)) collect(resolve(path, name));
  } else if (path.endsWith('.md')) {
    markdownFiles.push(path);
  }
}

for (const path of scanRoots) collect(resolve(root, path));

for (const path of markdownFiles) {
  const contents = readFileSync(path, 'utf8');
  for (const match of contents.matchAll(/\[[^\]]*]\(([^)]+)\)/g)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, '');
    let target = rawTarget.split('#', 1)[0];
    if (!target || /^(https?:|mailto:)/.test(target)) continue;

    try {
      target = decodeURIComponent(target);
    } catch {
      errors.push(`${relative(root, path)}: invalid encoded link ${rawTarget}`);
      continue;
    }

    const projectPath = relative(root, path);
    if (projectPath === 'docs/business-processes/process-template.md' && target === 'path.md') {
      continue;
    }

    if (!existsSync(resolve(dirname(path), target))) {
      errors.push(`${projectPath}: missing local link target ${rawTarget}`);
    }
  }
}

if (errors.length > 0) {
  console.error(`Documentation link checks failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Documentation link checks passed: ${markdownFiles.length} Markdown files.`);
}
