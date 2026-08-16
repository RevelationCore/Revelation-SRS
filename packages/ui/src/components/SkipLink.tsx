/**
 * "Skip to main content" — the first focusable element on the page. Hidden
 * off-screen until it receives keyboard focus, so sighted mouse users never
 * see it, but a keyboard user doesn't have to tab through the entire nav
 * sidebar (10-20+ links) on every single page before reaching content.
 */
export function SkipLink({ targetId = 'main-content' }: { targetId?: string }) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary-600 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-white"
    >
      Skip to main content
    </a>
  );
}
