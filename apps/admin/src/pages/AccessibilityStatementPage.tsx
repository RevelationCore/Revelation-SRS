export function AccessibilityStatementPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Accessibility Statement</h1>

      <p className="text-sm text-gray-500 mb-6">
        Last reviewed: June 2026. Next review due: June 2027.
      </p>

      <section className="mb-6">
        <h2 className="text-lg font-medium text-gray-900 mb-2">Conformance status</h2>
        <p className="text-sm text-gray-700">
          Revelation SRS Administration is designed to conform to{' '}
          <abbr title="Web Content Accessibility Guidelines">WCAG</abbr> 2.1 Level AA.
          We believe this application substantially conforms to WCAG 2.1 AA, with the
          known exceptions listed below.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-medium text-gray-900 mb-2">Technical information</h2>
        <p className="text-sm text-gray-700 mb-2">
          Revelation SRS is committed to making this administration application accessible.
          This application relies on the following technologies for conformance:
        </p>
        <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
          <li>HTML</li>
          <li>WAI-ARIA</li>
          <li>CSS</li>
          <li>JavaScript (React 18)</li>
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-medium text-gray-900 mb-2">Known limitations</h2>

        <div className="border border-yellow-200 bg-yellow-50 rounded p-4 mb-4">
          <h3 className="text-sm font-medium text-yellow-900 mb-1">
            Mobile navigation overflow (R-A11Y-001) — Accepted exception
          </h3>
          <p className="text-sm text-yellow-800">
            The left-hand navigation sidebar does not collapse to a mobile-friendly menu on
            narrow viewports. Revelation SRS Administration is a desktop-first application
            intended for use by registry staff, regulatory officers, and administrators on
            workstation-class screens. Mobile access is not a primary use case for this
            application. This limitation is formally accepted as a documented exception.
            Planned remediation: post-v1.0.0 release if institutional mobile use cases are
            confirmed.
          </p>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-medium text-gray-900 mb-2">Assessment approach</h2>
        <p className="text-sm text-gray-700 mb-2">
          Accessibility was assessed using:
        </p>
        <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
          <li>Automated axe-core scans via Playwright on all 26 authenticated routes</li>
          <li>Keyboard-only navigation testing (Tab, Enter, Escape, arrow keys)</li>
          <li>Screen reader testing with NVDA on Windows and VoiceOver on macOS</li>
          <li>Manual review of heading hierarchy, form labels, and colour contrast</li>
          <li>Colour contrast verification against WCAG AA thresholds (4.5:1 normal text, 3:1 large text)</li>
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-medium text-gray-900 mb-2">Feedback and contact</h2>
        <p className="text-sm text-gray-700">
          If you encounter an accessibility barrier in this application, please report it to
          your institution's system administrator or to{' '}
          <a
            href="mailto:accessibility@revelation-srs.org"
            className="text-indigo-600 hover:text-indigo-800 underline"
          >
            accessibility@revelation-srs.org
          </a>
          . We aim to acknowledge accessibility reports within 5 working days.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-medium text-gray-900 mb-2">Enforcement</h2>
        <p className="text-sm text-gray-700">
          If you are not satisfied with our response, contact the{' '}
          <a
            href="https://www.equalityhumanrights.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-600 hover:text-indigo-800 underline"
          >
            Equality and Human Rights Commission
          </a>{' '}
          (EHRC) in Great Britain, or the{' '}
          <a
            href="https://www.equalityni.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-600 hover:text-indigo-800 underline"
          >
            Equality Commission for Northern Ireland
          </a>{' '}
          (ECNI).
        </p>
      </section>
    </main>
  );
}
