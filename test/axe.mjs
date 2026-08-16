import { expect } from 'vitest';
import { axe } from 'jest-axe';

/** Assert a rendered container has no automatically detectable accessibility violations. */
export async function expectNoA11yViolations(container) {
  const results = await axe(container);
  expect(results).toHaveNoViolations();
}
