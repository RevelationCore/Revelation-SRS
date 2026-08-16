import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type FindingClass = 'product-assertion' | 'accessibility' | 'console' | 'network' | 'authentication' | 'data' | 'environment';
export interface Finding { storyId: string; title: string; scenario: string; persona: string; severity: 'High' | 'Medium' | 'Low'; classification: FindingClass; url: string; expected: string; actual: string; evidence: string[]; }
export interface UatRunContext { runId: string; commitSha: string; startedAt: string; browser: string; operatingSystem: string; scenarioVersion: string | null; status: 'valid' | 'invalid-environment'; serviceHealth: Record<string, { ok: boolean; detail: string }>; }
export interface GroupedFinding extends Finding { fingerprint: string; occurrences: number; affectedStories: string[]; }

const SEVERITY_ORDER: Record<Finding['severity'], number> = { High: 0, Medium: 1, Low: 2 };

export function defaultRunContext(overrides: Partial<UatRunContext> = {}): UatRunContext {
  let commitSha = process.env['GITHUB_SHA'] ?? 'unknown';
  if (commitSha === 'unknown') {
    try { commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* optional */ }
  }
  const startedAt = new Date().toISOString();
  return { runId: process.env['GITHUB_RUN_ID'] ?? `local-${startedAt.replaceAll(/[:.]/g, '-')}`, commitSha, startedAt, browser: process.env['UAT_BROWSER'] ?? 'chromium', operatingSystem: `${process.platform}-${process.arch}`, scenarioVersion: null, status: 'valid', serviceHealth: {}, ...overrides };
}

function normalise(actual: string): string {
  return actual.replaceAll(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '<id>').replaceAll(/https?:\/\/[^\s]+/g, (value) => {
    try { const url = new URL(value); return `${url.origin}${url.pathname}`; } catch { return value; }
  });
}

export function groupFindings(findings: Finding[]): GroupedFinding[] {
  const groups = new Map<string, GroupedFinding>();
  for (const finding of findings) {
    const fingerprint = `${finding.classification}|${finding.severity}|${normalise(finding.actual)}`;
    const existing = groups.get(fingerprint);
    if (existing) {
      existing.occurrences += 1;
      if (!existing.affectedStories.includes(finding.storyId)) existing.affectedStories.push(finding.storyId);
    } else groups.set(fingerprint, { ...finding, fingerprint, occurrences: 1, affectedStories: [finding.storyId] });
  }
  return [...groups.values()].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export function renderFindings(findings: Finding[], context = defaultRunContext()): string {
  const grouped = groupFindings(findings);
  const productCount = context.status === 'valid' ? grouped.filter((finding) => finding.classification !== 'environment').length : 0;
  const lines = [
    `# Automated UAT Findings — ${context.startedAt.slice(0, 10)}`, '',
    `> Run: ${context.runId} · Commit: ${context.commitSha} · Status: **${context.status}**`,
    `> Browser: ${context.browser} · OS: ${context.operatingSystem} · Scenario version: ${context.scenarioVersion ?? 'unknown'}`, '',
    context.status === 'invalid-environment' ? '**Environment invalidated the run. No product defect count is published.**' : `**${productCount} grouped product finding(s)** from ${findings.length} observation(s) across ${new Set(findings.map((finding) => finding.storyId)).size} stories.`, '',
    '## Service preflight', '',
    ...Object.entries(context.serviceHealth).map(([name, health]) => `- ${health.ok ? 'PASS' : 'FAIL'} **${name}:** ${health.detail}`), '',
  ];
  if (grouped.length === 0) lines.push('No issues found. All checks passed.', '');
  for (const finding of grouped) {
    lines.push(`## ${finding.storyId} — ${finding.title}`, '', `- **Class:** ${finding.classification}`, `- **Severity:** ${finding.severity}`, `- **Occurrences:** ${finding.occurrences}`, `- **Affected stories:** ${finding.affectedStories.join(', ')}`, `- **Scenario/persona:** ${finding.scenario} / ${finding.persona}`, `- **URL:** ${finding.url}`, `- **Expected:** ${finding.expected}`, `- **Actual:** ${finding.actual}`, '');
  }
  return lines.join('\n');
}

export function writeReport(findings: Finding[], context = defaultRunContext(), outDir = 'docs/uat1/reports'): { markdown: string; json: string } {
  const base = `automated-uat-findings-${context.startedAt.slice(0, 10)}-${context.runId}`.replaceAll(/[^a-zA-Z0-9._-]/g, '-');
  const directory = join(process.cwd(), outDir);
  mkdirSync(directory, { recursive: true });
  const markdown = join(directory, `${base}.md`);
  const json = join(directory, `${base}.json`);
  const groupedFindings = groupFindings(findings);
  writeFileSync(markdown, renderFindings(findings, context), 'utf8');
  writeFileSync(json, JSON.stringify({ schemaVersion: 1, context, findings, groupedFindings }, null, 2), 'utf8');
  return { markdown, json };
}
