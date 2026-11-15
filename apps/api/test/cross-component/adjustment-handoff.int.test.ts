/**
 * AJ-21 cross-component hand-off, end to end over a real event bus.
 *
 * Each component's own suite tests it in isolation (stub SRS client, spy
 * event bus, dispatch() called directly), which is how the hand-offs between
 * them went untested and broke unnoticed: the VLE adapter waited for an
 * event that only followed its own acknowledgement, and the wellbeing module
 * sent case types the SRS rejects. This test runs the real pieces together:
 *
 *   wellbeing module ──HTTP──▶ SRS API ──NATS JetStream──▶ VLE adapter ──▶ stub VLE
 *                                 ▲                              │
 *                                 └────────HTTP replies──────────┘
 *
 * 1. SRS creates a module, an enrolment and a module registration; the
 *    adapter provisions the VLE course and enrolment from the real events.
 * 2. A wellbeing panel approves an adjustment case; the module hands it to
 *    the SRS over HTTP with the SRS adjustment type and amount.
 * 3. The SRS publishes srs.adjustment.distribution-requested.vle; the
 *    adapter sets the student's 25% time accommodation in the VLE and
 *    acknowledges, and the SRS distribution becomes 'distributed'.
 * 4. Expiry publishes ...distribution-withdrawal-requested.vle; the adapter
 *    removes the accommodation and confirms, and the distribution becomes
 *    'withdrawn'.
 *
 * Containers: SRS Postgres, wellbeing Postgres, VLE-adapter Postgres, NATS.
 * The wellbeing approval uses forceApprove because its SRS context
 * projection is fed by its own event consumer, which is not part of this
 * hand-off.
 */
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { IntegrationBusPublisher } from '../../src/platform/integration-bus/publisher.js';
import { startTestApp, type TestApp } from '../helpers/test-app.js';
// Other components, imported from their own source — this test sits in the
// API package only because that is where the SRS test harness lives.
import { SrsAdjustmentHttpClient } from '../../../../modules/wellbeing/src/srs/srs-adjustment-client.js';
import { startTestApp as startWellbeing, type TestWellbeingApp } from '../../../../modules/wellbeing/test/helpers/test-db.js';
import { VleEventConsumer } from '../../../../adapters/vle/src/consumers/vle-event-consumer.js';
import { HttpSrsAcknowledgementClient } from '../../../../adapters/vle/src/srs-client/acknowledgement-client.js';
import { HttpVleClient } from '../../../../adapters/vle/src/vle-client/client.js';
import { StubVleDriver } from '../../../../adapters/vle/src/vle-platforms/stub-driver.js';
import { startTestApp as startVleAdapter, type TestVleApp } from '../../../../adapters/vle/test/helpers/test-app.js';

const log = pino({ level: 'silent' });
const WAIT = { timeout: 20_000, interval: 200 };

let nats: StartedTestContainer;
let srs: TestApp;
let srsUrl: string;
let srsBus: IntegrationBusPublisher;
let wellbeing: TestWellbeingApp;
let vle: TestVleApp;
let consumer: VleEventConsumer;
let srsJwt: string;

beforeAll(async () => {
  nats = await new GenericContainer('nats:2.10-alpine')
    .withCommand(['-js'])
    .withExposedPorts(4222)
    .withWaitStrategy(Wait.forLogMessage(/Server is ready/))
    .start();
  const natsUrl = `nats://${nats.getHost()}:${nats.getMappedPort(4222)}`;

  // SRS with a real JetStream publisher (creates the SRS_EVENTS stream).
  srsBus = new IntegrationBusPublisher(natsUrl);
  await srsBus.connect();
  srs = await startTestApp({ eventBus: srsBus });
  await srs.app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = srs.app.server.address() as { port: number };
  srsUrl = `http://127.0.0.1:${port}`;
  srsJwt = await srs.makeJwt();

  // Wellbeing module calling the real SRS over HTTP.
  wellbeing = await startWellbeing({
    srsAdjustmentClient: new SrsAdjustmentHttpClient(srsUrl, srsJwt),
  });

  // VLE adapter consuming from NATS, writing to the stub VLE, replying to the real SRS.
  vle = await startVleAdapter();
  consumer = new VleEventConsumer(natsUrl, vle.db, srs.tenantId, log, {
    vleClient:      new HttpVleClient(vle.stubVleBaseUrl),
    srsAckClient:   new HttpSrsAcknowledgementClient(srsUrl, await srs.makeJwt({ roles: ['tenant-administrator'] })),
    platformDriver: new StubVleDriver(vle.stubVleBaseUrl),
  });
  await consumer.connect();
  await consumer.start();
}, 240_000);

afterAll(async () => {
  await consumer?.close();
  await srsBus?.close();
  await wellbeing?.teardown();
  await vle?.teardown();
  await srs?.teardown();
  await nats?.stop();
}, 120_000);

describe('AJ-21 hand-off: wellbeing → SRS → NATS → VLE adapter → VLE', () => {
  let personId: string;
  let enrolmentId: string;
  let moduleId: string;
  let adjustmentId: string;

  it('provisions the student in a VLE course from real SRS events', async () => {
    personId = (await srsPost('/api/v1/students', { legalFirstName: 'Nina', legalFamilyName: 'Handoff' }))
      .json<{ personId: string }>().personId;
    enrolmentId = (await srsPost('/api/v1/enrolments', {
      personId, modeOfStudyCode: 'full-time', academicYearOfEntry: '2026-27', startDate: '2026-09-21',
    })).json<{ enrolmentId: string }>().enrolmentId;
    const academicPeriodId = (await srsPost('/api/v1/academic-periods', {
      academicYear: '2026-27', periodCode: 'XC-SEM1', periodTypeCode: 'semester', startDate: '2026-09-21', endDate: '2027-01-15',
    })).json<{ academicPeriodId: string }>().academicPeriodId;
    moduleId = (await srsPost('/api/v1/modules', { code: 'XC101', title: 'Cross-component Study', creditValue: 20 }))
      .json<{ moduleId: string }>().moduleId;
    const moduleOfferingId = (await srsPost('/api/v1/module-offerings', {
      moduleId, academicPeriodId, deliveryModeCode: 'in-person', capacity: 30,
    })).json<{ moduleOfferingId: string }>().moduleOfferingId;
    await srsPost('/api/v1/module-registrations', { enrolmentId, moduleOfferingId, registrationDate: '2026-09-21' });

    await vi.waitFor(() => {
      expect(vle.stubVle.stubStore.courses.has(moduleId)).toBe(true);
      expect([...vle.stubVle.stubStore.enrolments.values()].some((e) => e.personId === personId)).toBe(true);
    }, WAIT);
  });

  it('a wellbeing approval reaches the SRS with the SRS adjustment type and amount', async () => {
    const adviserJwt = wellbeing.makeJwt();
    const disability = await wellbeing.app.inject({
      method: 'POST', url: '/api/v1/disability-cases',
      headers: { authorization: `Bearer ${adviserJwt}` },
      payload: { personId, supportTypeCode: 'dsa', dsaAwardRef: 'DSA-XC-1' },
    });
    expect(disability.statusCode).toBe(201);
    const dc = disability.json<{ id: string; wellbeingCaseId: string }>();

    const created = await wellbeing.app.inject({
      method: 'POST', url: '/api/v1/adjustment-cases',
      headers: { authorization: `Bearer ${adviserJwt}` },
      payload: { wellbeingCaseId: dc.wellbeingCaseId, disabilitySupportCaseId: dc.id, personId, adjustmentTypeCode: 'exam-time' },
    });
    expect(created.statusCode).toBe(201);
    const caseId = created.json<{ id: string }>().id;
    await wellbeing.app.inject({
      method: 'POST', url: `/api/v1/adjustment-cases/${caseId}/start-assessment`,
      headers: { authorization: `Bearer ${adviserJwt}` },
    });
    await wellbeing.app.inject({
      method: 'POST', url: `/api/v1/adjustment-cases/${caseId}/assessments`,
      headers: { authorization: `Bearer ${adviserJwt}` },
      payload: { assessorId: 'adviser-1', assessedAt: '2026-09-10T10:00:00Z', outcomeCode: 'recommended' },
    });

    const approved = await wellbeing.app.inject({
      method: 'POST', url: `/api/v1/adjustment-cases/${caseId}/approve`,
      headers: { authorization: `Bearer ${wellbeing.makeJwt({ roles: ['wellbeing-panel-chair'] })}` },
      payload: {
        enrolmentId,
        adjustmentTypeCode:    'extra-time',
        scopeCode:             'all',
        recommendedAdjustment: '25% extra time in timed assessments',
        validFrom:             '2026-09-21T00:00:00.000Z',
        amount:                { value: 25, unitCode: 'percent-of-duration' },
        notes:                 'Cross-component note that must not reach the VLE',
        forceApprove:          true,
      },
    });
    expect(approved.statusCode, approved.body).toBe(202);
    adjustmentId = approved.json<{ adjustmentId: string }>().adjustmentId;

    const adjustment = await srsGet(`/api/v1/adjustments/${adjustmentId}`);
    expect(adjustment.json()).toMatchObject({
      adjustmentTypeCode: 'extra-time',
      scopeCode: 'all',
      amount: { value: 25, unitCode: 'percent-of-duration' },
      sourceCaseId: caseId,
    });
  });

  it('the VLE applies the accommodation from the SRS instruction and the SRS records delivery', async () => {
    const vleCourseId = vle.stubVle.stubStore.courses.get(moduleId)!.vleCourseId;

    await vi.waitFor(async () => {
      expect(vle.stubVle.stubStore.timeAccommodations.get(`${vleCourseId}:${personId}`)?.extraTimePercent).toBe(25);
      const vleRow = (await distributions()).find((d) => d.targetSystem === 'vle');
      expect(vleRow?.statusCode).toBe('distributed');
    }, WAIT);

    // Only the VLE acts in this test. Exams is the SRS's own exam-entry flow
    // (confirmed when a schedule comes back; see exam-entry-adjustments), and
    // no attendance consumer exists yet.
    const others = (await distributions()).filter((d) => d.targetSystem !== 'vle');
    expect(others.map((d) => d.statusCode)).toEqual(['pending', 'pending']);
    expect(others.every((d) => d.requestPublishedAt !== null)).toBe(true);
  });

  it('expiry withdraws it from the VLE and the SRS records the withdrawal', async () => {
    const vleCourseId = vle.stubVle.stubStore.courses.get(moduleId)!.vleCourseId;
    const expired = await srs.app.inject({
      method: 'POST', url: `/api/v1/adjustments/${adjustmentId}/expire`,
      headers: { authorization: `Bearer ${srsJwt}` },
    });
    expect(expired.statusCode).toBe(204);

    await vi.waitFor(async () => {
      expect(vle.stubVle.stubStore.timeAccommodations.has(`${vleCourseId}:${personId}`)).toBe(false);
      const vleRow = (await distributions()).find((d) => d.targetSystem === 'vle');
      expect(vleRow?.statusCode).toBe('withdrawn');
    }, WAIT);
  });

  async function distributions(): Promise<Array<{ targetSystem: string; statusCode: string; requestPublishedAt: string | null }>> {
    return (await srsGet(`/api/v1/adjustments/${adjustmentId}/distributions`)).json();
  }
});

async function srsPost(url: string, payload: Record<string, unknown>) {
  const res = await srs.app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${srsJwt}` }, payload });
  expect(res.statusCode, `${url}: ${res.body}`).toBe(201);
  return res;
}

async function srsGet(url: string) {
  const res = await srs.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${srsJwt}` } });
  expect(res.statusCode, `${url}: ${res.body}`).toBe(200);
  return res;
}
