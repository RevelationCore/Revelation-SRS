import { describe, expect, it } from 'vitest';

import { defaultRunContext, groupFindings, renderFindings, type Finding } from './findings-reporter.js';

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    storyId: 'STORY-1',
    title: 'Example story',
    scenario: 'ci-golden',
    persona: 'student',
    severity: 'Medium',
    classification: 'network',
    url: 'http://localhost:5174/dashboard',
    expected: 'Page loads',
    actual: 'HTTP 500 on http://localhost:3000/api/v1/students/11111111-1111-1111-1111-111111111111',
    evidence: [],
    ...overrides,
  };
}

describe('groupFindings', () => {
  it('groups repeated failures with the same classification, severity and normalised symptom into one entry', () => {
    const findings = [
      finding({ storyId: 'STORY-1' }),
      finding({ storyId: 'STORY-2', actual: 'HTTP 500 on http://localhost:3000/api/v1/students/22222222-2222-2222-2222-222222222222' }),
      finding({ storyId: 'STORY-1', title: 'Same story, second occurrence' }),
    ];
    const grouped = groupFindings(findings);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.occurrences).toBe(3);
    expect(grouped[0]?.affectedStories.sort()).toEqual(['STORY-1', 'STORY-2']);
  });

  it('does not group findings with a different classification or severity even when the text matches', () => {
    const findings = [
      finding({ classification: 'network' }),
      finding({ classification: 'authentication' }),
      finding({ severity: 'High' }),
    ];
    expect(groupFindings(findings)).toHaveLength(3);
  });

  it('normalises UUIDs and URL query/paths so the same underlying fault fingerprints identically', () => {
    const findings = [
      finding({ actual: 'Failed to fetch https://api.example.ac.uk/api/v1/students/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee?token=abc123' }),
      finding({ actual: 'Failed to fetch https://api.example.ac.uk/api/v1/students/ffffffff-0000-1111-2222-333333333333?token=xyz789' }),
    ];
    expect(groupFindings(findings)).toHaveLength(1);
  });

  it('sorts grouped findings by severity, most severe first', () => {
    const grouped = groupFindings([
      finding({ severity: 'Low', actual: 'low issue' }),
      finding({ severity: 'High', actual: 'high issue' }),
      finding({ severity: 'Medium', actual: 'medium issue' }),
    ]);
    expect(grouped.map((g) => g.severity)).toEqual(['High', 'Medium', 'Low']);
  });
});

describe('renderFindings', () => {
  it('publishes no product defect count when the run is environment-invalidated, regardless of findings passed in', () => {
    const context = defaultRunContext({ status: 'invalid-environment', serviceHealth: { api: { ok: false, detail: 'ECONNREFUSED' } } });
    const markdown = renderFindings([finding()], context);
    expect(markdown).toContain('Environment invalidated the run. No product defect count is published.');
    expect(markdown).not.toContain('1 grouped product finding');
  });

  it('excludes environment-classified findings from the product finding count on a valid run', () => {
    const context = defaultRunContext({ status: 'valid' });
    const markdown = renderFindings([finding({ classification: 'environment' }), finding({ classification: 'network', storyId: 'STORY-2' })], context);
    expect(markdown).toContain('1 grouped product finding(s)');
  });

  it('reports no issues found for an empty, valid run', () => {
    const markdown = renderFindings([], defaultRunContext({ status: 'valid' }));
    expect(markdown).toContain('No issues found. All checks passed.');
  });
});

describe('defaultRunContext', () => {
  it('defaults to a valid run with an empty service-health map', () => {
    const context = defaultRunContext();
    expect(context.status).toBe('valid');
    expect(context.serviceHealth).toEqual({});
    expect(context.commitSha.length).toBeGreaterThan(0);
  });

  it('allows overriding individual fields without losing the rest', () => {
    const context = defaultRunContext({ browser: 'firefox' });
    expect(context.browser).toBe('firefox');
    expect(context.status).toBe('valid');
  });
});
