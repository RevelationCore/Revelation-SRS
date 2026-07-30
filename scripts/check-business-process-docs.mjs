import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const libraryRoot = join(repositoryRoot, 'docs', 'business-processes');
const errors = [];

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.name.endsWith('.md') ? [path] : [];
  });
}

const files = markdownFiles(libraryRoot);
const processPages = files.filter((path) => /\/bp-\d{2}-\d{3}-[^/]+\.md$/.test(path));
const seenIds = new Map();
const inventoryPath = join(libraryRoot, 'process-inventory.md');
const sourceRegisterPath = join(libraryRoot, 'source-register.md');
const inventoryContents = readFileSync(inventoryPath, 'utf8');
const sourceRegisterContents = readFileSync(sourceRegisterPath, 'utf8');
const inventoryIds = new Set([...inventoryContents.matchAll(/\[(BP-\d{2}-\d{3})\]\([^)]+\.md\)/g)].map((match) => match[1]));
const sourceIds = new Set([...sourceRegisterContents.matchAll(/^\| (SRC-\d{3}) \|/gm)].map((match) => match[1]));
const requiredHeadings = [
  '## Applicability',
  '## Traceability',
  '## Purpose and outcome',
  '## Scope',
  '## Actors and responsibilities',
  '## Preconditions',
  '## Trigger',
  '## Main flow',
  '## Alternative flows',
  '## Exception flows',
  '## Postconditions',
  '## Business rules and controls',
  '## National and institutional variations',
  '## Data impact',
  '## Integration impact',
  '## Sequence diagram',
  '## Open questions and decisions',
  '## Sources',
  '## Related processes',
  '## Review record',
  '## Change history',
];

for (const file of files) {
  const contents = readFileSync(file, 'utf8');
  const displayPath = relative(repositoryRoot, file);

  for (const match of contents.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const rawTarget = match[1].trim();
    if (
      rawTarget.startsWith('http://') ||
      rawTarget.startsWith('https://') ||
      rawTarget.startsWith('mailto:') ||
      rawTarget.startsWith('#')
    ) continue;

    const targetWithoutAnchor = rawTarget.split('#', 1)[0];
    if (!targetWithoutAnchor || targetWithoutAnchor.includes('path.md')) continue;
    const target = resolve(dirname(file), decodeURIComponent(targetWithoutAnchor));
    if (!existsSync(target)) {
      errors.push(`${displayPath}: broken local link: ${rawTarget}`);
    }
  }

  const mermaidOpen = (contents.match(/```mermaid/g) ?? []).length;
  const fenceCount = (contents.match(/^```/gm) ?? []).length;
  if (mermaidOpen > 0 && fenceCount % 2 !== 0) {
    errors.push(`${displayPath}: unclosed Markdown code fence`);
  }
}

for (const file of processPages) {
  const contents = readFileSync(file, 'utf8');
  const displayPath = relative(repositoryRoot, file);
  const titleMatch = contents.match(/^# (BP-\d{2}-\d{3}) — (.+)$/m);

  if (!titleMatch) {
    errors.push(`${displayPath}: missing canonical process title`);
    continue;
  }

  const [, id] = titleMatch;
  if (seenIds.has(id)) {
    errors.push(`${displayPath}: duplicate process ID ${id} also used by ${seenIds.get(id)}`);
  }
  seenIds.set(id, displayPath);

  const filenameId = file.match(/\/(bp-\d{2}-\d{3})-/)?.[1]?.toUpperCase();
  if (filenameId !== id) {
    errors.push(`${displayPath}: filename ID does not match title ID ${id}`);
  }

  if (!inventoryIds.has(id)) {
    errors.push(`${displayPath}: ${id} is not linked from the process inventory`);
  }

  for (const metadata of ['> Status: Draft', '> Owner:', '> Version:', '> Last reviewed:', '> Review by:']) {
    if (!contents.includes(metadata)) errors.push(`${displayPath}: missing or inconsistent metadata ${metadata}`);
  }

  for (const heading of requiredHeadings) {
    if (!contents.includes(heading)) errors.push(`${displayPath}: missing heading ${heading}`);
  }

  if (!contents.includes('sequenceDiagram')) {
    errors.push(`${displayPath}: sequence diagram is missing or is not a Mermaid sequenceDiagram`);
  }

  for (const nation of ['### England', '### Scotland', '### Wales', '### Northern Ireland']) {
    if (!contents.includes(nation)) errors.push(`${displayPath}: missing national section ${nation}`);
  }

  if (/(?<!-)\bSIS\b(?!-)/.test(contents)) {
    errors.push(`${displayPath}: uses non-canonical unqualified system name SIS`);
  }

  const mainFlow = contents.match(/## Main flow\n\n([\s\S]*?)\n\n## Alternative flows/)?.[1] ?? '';
  const stepNumbers = [...mainFlow.matchAll(/^(\d+)\. /gm)].map((match) => Number(match[1]));
  if (stepNumbers.length === 0 || stepNumbers.some((number, index) => number !== index + 1)) {
    errors.push(`${displayPath}: main-flow numbering is missing or non-sequential`);
  }

  const actorSection = contents.match(/## Actors and responsibilities\n\n([\s\S]*?)\n\n\*\*Accountable owner:/)?.[1] ?? '';
  const actors = new Set([...actorSection.matchAll(/^\| ([^|]+) \|/gm)]
    .map((match) => match[1].replace(/\s+`PROPOSED`$/, '').trim())
    .filter((actor) => actor !== 'Actor/system'));
  const diagram = contents.match(/```mermaid\n([\s\S]*?)```/)?.[1] ?? '';
  const participants = [...diagram.matchAll(/^\s*(?:actor|participant)\s+\S+\s+as\s+(.+)$/gm)].map((match) => match[1].trim());
  for (const participant of participants) {
    if (!actors.has(participant) && participant !== 'SRS') {
      errors.push(`${displayPath}: Mermaid participant "${participant}" is not named in the actor table`);
    }
  }

  for (const sourceId of new Set([...contents.matchAll(/SRC-\d{3}/g)].map((match) => match[0]))) {
    if (!sourceIds.has(sourceId)) errors.push(`${displayPath}: references unknown source ${sourceId}`);
  }
}

for (const id of inventoryIds) {
  if (!seenIds.has(id)) errors.push(`process-inventory.md: linked process ${id} has no process page`);
}

if (seenIds.size !== 63) {
  errors.push(`expected 63 unique process pages, found ${seenIds.size}`);
}

if (errors.length > 0) {
  console.error(`Business process documentation checks failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Business process documentation checks passed: ${files.length} files, ${processPages.length} process pages.`);
}
