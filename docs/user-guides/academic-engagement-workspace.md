# Academic Engagement Workspace

> Status: Implemented — Increment F
>
> Audience: Engagement Officers, Personal Tutors, Registry Administrators and Tenant Administrators

Open **Engagement** from the staff application navigation. The workspace deliberately separates expected activity, observed evidence, policy evaluation and human decisions.

## Alert queue

Each alert shows the policy version, evidence counts, absence rate, severity and evidence-quality state. An alert is a prompt for human review, not an academic-status or sponsor-reporting decision.

Alerts marked **suspended-reconciliation** cannot be opened as interventions until disputed, missing, conflicting or quarantined evidence has been reconciled.

## Evidence worklist

The worklist shows expected activity, student, mode and source. Corrections retain the previous observation and mark affected alerts for re-evaluation.

## Intervention case

The case page records:

1. accessible contact attempts and the communication language, including Welsh (`cy`);
2. operational actions, owners and due dates;
3. authoritative-version reviews and closure outcomes; and
4. minimum-necessary referrals to wellbeing, safeguarding, academic-status review or sponsor-compliance review.

## Sponsor-compliance hand-off

A sponsor-compliance referral does not make a UKVI decision. In **Regulatory → UKVI → Sponsor decisions**, authorised staff work from an immutable snapshot of the engagement evidence and its policy version.

1. A compliance officer records `report`, `no-report` or `further-review`, with a rationale code and the Student sponsor guidance version used.
2. Evidence marked for reconciliation permits only `further-review`.
3. A different authorised officer reviews and authorises the decision.
4. Only an authorised `report` decision creates an outbound UKVI exchange. The direct attendance-report action is retired.
5. The operational cards show decisions awaiting authorisation, evidence requiring reconciliation and failed/dead-letter exchanges.

Institutional roles, approval thresholds and live transport remain tenant configuration. Academic-status decisions remain separate throughout.

Do not enter medical, disability, safeguarding or mental-health narrative in general engagement notes. Specialist services retain their own restricted evidence.

## Policy administration

Tenant Administrators can create approved, effective-dated policy versions. Existing versions and alert evidence remain immutable so an SME or auditor can reproduce why an alert was created.

## Demonstration stories

The CI golden dataset includes four fictional stories:

- attended activity;
- authorised alternative engagement;
- disputed evidence suspended for reconciliation; and
- sustained non-engagement referred for an independent human compliance review.
