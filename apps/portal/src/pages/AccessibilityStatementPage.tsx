export function AccessibilityStatementPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold text-neutral-900 mb-6">Accessibility Statement</h1>

      <p className="text-sm text-neutral-500 mb-6">
        Last reviewed: June 2026. Next review due: June 2027.
      </p>

      <section className="mb-6">
        <h2 className="text-lg font-medium text-neutral-900 mb-2">Conformance status</h2>
        <p className="text-sm text-neutral-700">
          The Revelation SRS Student Portal is designed to conform to{' '}
          <abbr title="Web Content Accessibility Guidelines">WCAG</abbr> 2.1 Level AA.
          We believe this portal substantially conforms to WCAG 2.1 AA with no known
          material exceptions.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-medium text-neutral-900 mb-2">Technical information</h2>
        <p className="text-sm text-neutral-700 mb-2">
          This portal relies on the following technologies for conformance:
        </p>
        <ul className="list-disc list-inside text-sm text-neutral-700 space-y-1">
          <li>HTML</li>
          <li>WAI-ARIA</li>
          <li>CSS</li>
          <li>JavaScript (React 18)</li>
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-medium text-neutral-900 mb-2">Assessment approach</h2>
        <p className="text-sm text-neutral-700 mb-2">
          Accessibility was assessed using:
        </p>
        <ul className="list-disc list-inside text-sm text-neutral-700 space-y-1">
          <li>Automated axe-core scans via Playwright on all 14 authenticated routes</li>
          <li>Keyboard-only navigation testing (Tab, Enter, Escape, arrow keys)</li>
          <li>Screen reader testing with NVDA on Windows and VoiceOver on macOS</li>
          <li>Manual review of heading hierarchy, form labels, and colour contrast</li>
          <li>Colour contrast verification against WCAG AA thresholds (4.5:1 normal text, 3:1 large text)</li>
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-medium text-neutral-900 mb-2">Known limitations</h2>
        <p className="text-sm text-neutral-700">
          No material accessibility limitations are currently known. If you discover an
          issue, please report it using the contact details below.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-medium text-neutral-900 mb-2">Feedback and contact</h2>
        <p className="text-sm text-neutral-700">
          If you encounter an accessibility barrier in this portal, please contact your
          institution's student services team or email{' '}
          <a
            href="mailto:accessibility@revelation-srs.org"
            className="text-primary-600 hover:text-primary-800 underline"
          >
            accessibility@revelation-srs.org
          </a>
          . We aim to acknowledge accessibility reports within 5 working days.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-medium text-neutral-900 mb-2">Enforcement</h2>
        <p className="text-sm text-neutral-700">
          If you are not satisfied with our response, contact the{' '}
          <a
            href="https://www.equalityhumanrights.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-600 hover:text-primary-800 underline"
          >
            Equality and Human Rights Commission
          </a>{' '}
          (EHRC) in Great Britain, or the{' '}
          <a
            href="https://www.equalityni.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-600 hover:text-primary-800 underline"
          >
            Equality Commission for Northern Ireland
          </a>{' '}
          (ECNI).
        </p>
      </section>
    </main>
  );
}
