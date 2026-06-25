/**
 * Converts Playwright test failures into a structured markdown findings file
 * at docs/uat1/reports/automated-uat-findings-YYYY-MM-DD.md.
 *
 * Usage: imported by remaining-stories.spec.ts and called in afterAll.
 * The generated file is git-ignored; review findings manually before raising
 * GitHub issues with the UAT bug template.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface Finding {
  storyId:     string;
  title:       string;
  scenario:    string;
  persona:     string;
  severity:    'High' | 'Medium' | 'Low';
  url:         string;
  expected:    string;
  actual:      string;
  evidence:    string[];
}

const SEVERITY_ORDER: Record<Finding['severity'], number> = { High: 0, Medium: 1, Low: 2 };

export function renderFindings(findings: Finding[]): string {
  if (findings.length === 0) {
    return `# Automated UAT Findings — ${today()}\n\nNo issues found. All checks passed.\n`;
  }

  const sorted = [...findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  const lines: string[] = [
    `# Automated UAT Findings — ${today()}`,
    '',
    `**${findings.length} issue(s) found** across ${uniqueStories(findings)} stories.`,
    '',
    '---',
    '',
  ];

  for (const f of sorted) {
    lines.push(
      `## ${f.storyId} — ${f.title}`,
      '',
      `- **Scenario:** ${f.scenario}`,
      `- **Persona:** ${f.persona}`,
      `- **URL:** ${f.url}`,
      `- **Severity:** ${f.severity}`,
      `- **Expected:** ${f.expected}`,
      `- **Actual:** ${f.actual}`,
    );
    if (f.evidence.length > 0) {
      lines.push('- **Evidence:**');
      for (const e of f.evidence) {
        lines.push(`  - ${e}`);
      }
    }
    lines.push('', '---', '');
  }

  return lines.join('\n');
}

export function writeReport(findings: Finding[], outDir = 'docs/uat1/reports'): string {
  const filename = `automated-uat-findings-${today()}.md`;
  const outPath  = join(process.cwd(), outDir, filename);
  mkdirSync(join(process.cwd(), outDir), { recursive: true });
  writeFileSync(outPath, renderFindings(findings), 'utf-8');
  return outPath;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function uniqueStories(findings: Finding[]): number {
  return new Set(findings.map(f => f.storyId)).size;
}
