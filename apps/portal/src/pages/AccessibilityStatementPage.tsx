export function AccessibilityStatementPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold text-neutral-900 mb-6">Accessibility Statement</h1>

      <p className="text-sm text-neutral-500 mb-6">
        Last reviewed: August 2026. Next review due: August 2027.
      </p>

      <section className="mb-6">
        <h2 className="text-lg font-medium text-neutral-900 mb-2">Conformance status</h2>
        <p className="text-sm text-neutral-700">
          The Revelation SRS Student Portal is designed to conform to{' '}
          <abbr title="Web Content Accessibility Guidelines">WCAG</abbr> 2.1 Level AA.
          We believe this portal substantially conforms to WCAG 2.1 AA on the basis of
          automated testing and manual code-level review (see "Assessment approach"
          below), with the known limitations listed below. This conformance basis has
          not been independently audited or verified by testing with real assistive
          technology users.
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
          <li>Automated axe-core scans (WCAG 2.1 A/AA and WCAG 2.1 AA-additional rule sets) via Playwright on all 17 authenticated routes plus the sign-in, forbidden, and this accessibility statement page</li>
          <li>Automated keyboard-operability tests covering sign-in, primary navigation, modal dialogs, and inline confirm actions (Tab, Enter, Escape, arrow keys)</li>
          <li>Manual code-level review of heading structure, form label association, ARIA roles, and focus-visible styling, using semantic HTML and Radix UI accessible primitives (dialogs, tabs) as the underlying implementation</li>
        </ul>
        <p className="text-sm text-neutral-700 mt-2">
          Colour contrast has not been separately verified against WCAG AA thresholds
          beyond what the automated axe-core scans check; a manual contrast review has
          not been carried out.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-medium text-neutral-900 mb-2">Known limitations</h2>

        <div className="border border-warning-200 bg-warning-50 rounded p-4 mb-4">
          <h3 className="text-sm font-medium text-warning-900 mb-1">
            No assistive-technology user testing — Open gap
          </h3>
          <p className="text-sm text-warning-800">
            This portal has not been tested by people who use screen readers, switch
            devices, or other assistive technology, and has not undergone testing with
            a real screen reader (e.g. NVDA, JAWS, VoiceOver, TalkBack). Conformance is
            currently based on automated tooling and manual review against the WCAG
            success criteria, not on observed real-world use. This is a genuine gap,
            and remediation (either an independent audit or structured
            assistive-technology user testing) is intended but not yet scheduled.
          </p>
        </div>

        <div className="border border-warning-200 bg-warning-50 rounded p-4">
          <h3 className="text-sm font-medium text-warning-900 mb-1">
            No independent accessibility audit — Open gap
          </h3>
          <p className="text-sm text-warning-800">
            This statement reflects self-assessment by the development team, not a
            review by an independent accessibility specialist or auditor. WCAG 2.2 has
            also not yet been evaluated; this portal has only been assessed against
            WCAG 2.1.
          </p>
        </div>
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
