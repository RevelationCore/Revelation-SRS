import { Type } from '@sinclair/typebox';
import { requirePermission } from '@revelation-srs/auth';
import type { FastifyInstance } from 'fastify';

import type {
  DirectorDecisionInput,
  NominateSupervisorInput,
  OpenSupervisionCaseInput,
  StaffAssignmentDto,
  SupervisionCaseDto,
  SupervisorNominationDto,
} from '../platform/pgr/supervision-service.js';
import type {
  AddReviewMemberInput,
  OpenReviewInput,
  ProgressReviewDto,
  PublishMilestoneInput,
  RecordOutcomeInput,
  ResearchMilestoneDto,
  ReviewMemberDto,
} from '../platform/pgr/progress-review-service.js';
import type {
  CorrectionRequirementDto,
  ExaminationCaseDto,
  ExaminerAppointmentDto,
  ExaminerReportDto,
  NominateExaminerInput,
  ExaminationOutcomeDto,
  RatifyOutcomeInput,
  RecordExaminerReportInput,
  RecordVivaInput,
  SubmitThesisInput,
  ThesisSubmissionDto,
  VivaEventDto,
} from '../platform/pgr/examination-service.js';
import type {
  CompletionCaseDto,
  ConferResearchAwardInput,
  FinalThesisDepositDto,
  OpenCompletionCaseInput,
  RecordFinalDepositInput,
} from '../platform/pgr/completion-service.js';

const ErrorSchema = Type.Object({
  type:   Type.String(),
  title:  Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

const SupervisionCaseSchema = Type.Object({
  supervisionCaseId: Type.String(),
  enrolmentId:       Type.String(),
  statusCode:        Type.String(),
  ownerId:           Type.String(),
  degreeAim:         Type.Union([Type.String(), Type.Null()]),
  researchArea:      Type.Union([Type.String(), Type.Null()]),
  schoolOwner:       Type.Union([Type.String(), Type.Null()]),
  intendedStartDate: Type.Union([Type.String(), Type.Null()]),
  createdAt:         Type.String(),
});

const NominationSchema = Type.Object({
  nominationId:          Type.String(),
  supervisionCaseId:     Type.String(),
  personId:              Type.String(),
  roleDetailCode:        Type.String(),
  orgOwner:              Type.Union([Type.String(), Type.Null()]),
  externalOrganisation:  Type.Union([Type.String(), Type.Null()]),
  contractualStatusCode: Type.Union([Type.String(), Type.Null()]),
  accessLevelCode:       Type.Union([Type.String(), Type.Null()]),
  eligibilityCheckedAt:  Type.Union([Type.String(), Type.Null()]),
  nominatedAt:           Type.String(),
});

const StaffAssignmentSchema = Type.Object({
  assignmentId:          Type.String(),
  enrolmentId:           Type.String(),
  supervisionCaseId:     Type.String(),
  personId:              Type.String(),
  assignmentTypeCode:    Type.String(),
  roleDetailCode:        Type.String(),
  orgOwner:              Type.Union([Type.String(), Type.Null()]),
  externalOrganisation:  Type.Union([Type.String(), Type.Null()]),
  contractualStatusCode: Type.Union([Type.String(), Type.Null()]),
  accessLevelCode:       Type.Union([Type.String(), Type.Null()]),
  validFrom:             Type.String(),
  validTo:               Type.Union([Type.String(), Type.Null()]),
});

const ProgressReviewSchema = Type.Object({
  reviewId:          Type.String(),
  enrolmentId:       Type.String(),
  supervisionCaseId: Type.Union([Type.String(), Type.Null()]),
  reviewTypeCode:    Type.String(),
  statusCode:        Type.String(),
  ownerId:           Type.String(),
  createdAt:         Type.String(),
});

const ReviewMemberSchema = Type.Object({
  memberId:         Type.String(),
  reviewId:         Type.String(),
  personId:         Type.String(),
  roleCode:         Type.String(),
  conflictTypeCode: Type.Union([Type.String(), Type.Null()]),
  declaredAt:       Type.Union([Type.String(), Type.Null()]),
  recusedAt:        Type.Union([Type.String(), Type.Null()]),
});

const MilestoneSchema = Type.Object({
  milestoneId:       Type.String(),
  enrolmentId:       Type.String(),
  reviewId:          Type.Union([Type.String(), Type.Null()]),
  milestoneTypeCode: Type.String(),
  achievedDate:      Type.String(),
  publishedAt:       Type.Union([Type.String(), Type.Null()]),
});

const ExaminationCaseSchema = Type.Object({
  examinationCaseId: Type.String(),
  enrolmentId:       Type.String(),
  statusCode:        Type.String(),
  ownerId:           Type.String(),
  createdAt:         Type.String(),
});

const ThesisSubmissionSchema = Type.Object({
  submissionId:          Type.String(),
  examinationCaseId:     Type.String(),
  versionNumber:         Type.Number(),
  formatCode:            Type.String(),
  declarationConfirmed:  Type.Boolean(),
  restricted:            Type.Boolean(),
  restrictionReasonText: Type.Union([Type.String(), Type.Null()]),
  restrictionReviewDate: Type.Union([Type.String(), Type.Null()]),
  storageRef:            Type.String(),
  submittedAt:           Type.String(),
});

const ExaminerAppointmentSchema = Type.Object({
  appointmentId:         Type.String(),
  examinationCaseId:     Type.String(),
  personId:              Type.String(),
  examinerRoleCode:      Type.String(),
  independenceCheckedAt: Type.Union([Type.String(), Type.Null()]),
  conflictTypeCode:      Type.Union([Type.String(), Type.Null()]),
  recusedAt:             Type.Union([Type.String(), Type.Null()]),
  confirmedAt:           Type.Union([Type.String(), Type.Null()]),
});

const ExaminerReportSchema = Type.Object({
  reportId:              Type.String(),
  examinationCaseId:     Type.String(),
  examinerAppointmentId: Type.String(),
  reportRef:             Type.String(),
  recommendationCode:    Type.Union([Type.String(), Type.Null()]),
  submittedAt:           Type.String(),
});

const VivaEventSchema = Type.Object({
  vivaEventId:             Type.String(),
  examinationCaseId:       Type.String(),
  heldAt:                  Type.String(),
  jointRecommendationText: Type.String(),
  recordedAt:              Type.String(),
});

const ExaminationOutcomeSchema = Type.Object({
  outcomeId:         Type.String(),
  examinationCaseId: Type.String(),
  outcomeCode:       Type.String(),
  decidedBy:         Type.String(),
  decidedAt:         Type.String(),
});

const CorrectionRequirementSchema = Type.Object({
  requirementId: Type.String(),
  outcomeId:     Type.String(),
  deadlineDate:  Type.String(),
  completedAt:   Type.Union([Type.String(), Type.Null()]),
  completedBy:   Type.Union([Type.String(), Type.Null()]),
});

const CompletionCaseSchema = Type.Object({
  completionCaseId:  Type.String(),
  enrolmentId:       Type.String(),
  examinationCaseId: Type.String(),
  statusCode:        Type.String(),
  ownerId:           Type.String(),
  createdAt:         Type.String(),
});

const FinalThesisDepositSchema = Type.Object({
  depositId:              Type.String(),
  completionCaseId:       Type.String(),
  depositRef:             Type.String(),
  ipDeclarationConfirmed: Type.Boolean(),
  confirmedBy:            Type.String(),
  confirmedAt:            Type.String(),
});

export function pgrRoutes(fastify: FastifyInstance): void {
  fastify.post(
    '/pgr/supervision-cases',
    {
      schema: {
        body: Type.Object({
          enrolmentId:       Type.String(),
          ownerId:           Type.String(),
          degreeAim:         Type.Optional(Type.String()),
          researchArea:      Type.Optional(Type.String()),
          schoolOwner:       Type.Optional(Type.String()),
          intendedStartDate: Type.Optional(Type.String()),
        }),
        response: { 201: Type.Object({ supervisionCaseId: Type.String() }) },
      },
      preHandler: [requirePermission('pgr-case:write')],
    },
    async (request, reply) => {
      const body = request.body as OpenSupervisionCaseInput;
      const supervisionCaseId = await fastify.supervisionService.openSupervisionCase(request.tenantId, body, request.user.sub);

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'pgr_supervision_case',
        entityId:         supervisionCaseId,
        actionType:       'create',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(201).send({ supervisionCaseId });
    },
  );

  fastify.get(
    '/pgr/supervision-cases/:caseId',
    {
      schema: {
        params:   Type.Object({ caseId: Type.String() }),
        response: { 200: SupervisionCaseSchema, 404: ErrorSchema },
      },
      preHandler: [requirePermission('pgr-case:read')],
    },
    async (request, reply) => {
      const { caseId } = request.params as { caseId: string };
      const supervisionCase = await fastify.supervisionService.getSupervisionCase(request.tenantId, caseId);
      await reply.send(caseToWire(supervisionCase));
    },
  );

  fastify.post(
    '/pgr/supervision-cases/:caseId/nominations',
    {
      schema: {
        params: Type.Object({ caseId: Type.String() }),
        body: Type.Object({
          personId:              Type.String(),
          roleDetailCode:        Type.Union([Type.Literal('principal'), Type.Literal('additional'), Type.Literal('external')]),
          orgOwner:              Type.Optional(Type.String()),
          externalOrganisation:  Type.Optional(Type.String()),
          contractualStatusCode: Type.Optional(Type.String()),
          accessLevelCode:       Type.Optional(Type.String()),
        }),
        response: { 201: Type.Object({ nominationId: Type.String() }), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('pgr-case:write')],
    },
    async (request, reply) => {
      const { caseId } = request.params as { caseId: string };
      const body = request.body as NominateSupervisorInput;
      const nominationId = await fastify.supervisionService.nominateSupervisor(request.tenantId, caseId, body, request.user.sub);
      await reply.code(201).send({ nominationId });
    },
  );

  fastify.get(
    '/pgr/supervision-cases/:caseId/nominations',
    {
      schema: {
        params:   Type.Object({ caseId: Type.String() }),
        response: { 200: Type.Array(NominationSchema) },
      },
      preHandler: [requirePermission('pgr-case:read')],
    },
    async (request, reply) => {
      const { caseId } = request.params as { caseId: string };
      const nominations = await fastify.supervisionService.listNominations(request.tenantId, caseId);
      await reply.send(nominations.map(nominationToWire));
    },
  );

  fastify.post(
    '/pgr/supervision-cases/:caseId/nominations/:nominationId/eligibility-check',
    {
      schema: {
        params:   Type.Object({ caseId: Type.String(), nominationId: Type.String() }),
        response: { 204: Type.Null(), 404: ErrorSchema },
      },
      preHandler: [requirePermission('pgr-case:write')],
    },
    async (request, reply) => {
      const { nominationId } = request.params as { caseId: string; nominationId: string };
      await fastify.supervisionService.recordEligibilityCheck(request.tenantId, nominationId, request.user.sub);
      await reply.code(204).send();
    },
  );

  fastify.post(
    '/pgr/supervision-cases/:caseId/decision',
    {
      schema: {
        params: Type.Object({ caseId: Type.String() }),
        body: Type.Object({
          decisionTypeCode: Type.Union([Type.Literal('approve'), Type.Literal('return'), Type.Literal('reject')]),
          reasonText:       Type.Optional(Type.String()),
        }),
        response: { 204: Type.Null(), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('pgr-case:decide')],
    },
    async (request, reply) => {
      const { caseId } = request.params as { caseId: string };
      const body = request.body as DirectorDecisionInput;
      await fastify.supervisionService.recordDirectorDecision(request.tenantId, caseId, body, request.user.sub);

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'pgr_supervision_case',
        entityId:         caseId,
        actionType:       'update',
        fieldName:        'decision_type_code',
        afterValue:       { decisionTypeCode: body.decisionTypeCode },
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(204).send();
    },
  );

  fastify.post(
    '/pgr/supervision-cases/:caseId/publish',
    {
      schema: {
        params:   Type.Object({ caseId: Type.String() }),
        response: { 204: Type.Null(), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('pgr-case:write')],
    },
    async (request, reply) => {
      const { caseId } = request.params as { caseId: string };
      await fastify.supervisionService.publishToCris(request.tenantId, caseId, request.user.sub);
      await reply.code(204).send();
    },
  );

  fastify.get(
    '/enrolments/:enrolmentId/supervision',
    {
      schema: {
        params:   Type.Object({ enrolmentId: Type.String() }),
        response: { 200: Type.Array(StaffAssignmentSchema) },
      },
      preHandler: [requirePermission('pgr-case:read')],
    },
    async (request, reply) => {
      const { enrolmentId } = request.params as { enrolmentId: string };
      const assignments = await fastify.supervisionService.listCurrentAssignments(request.tenantId, enrolmentId);
      await reply.send(assignments.map(assignmentToWire));
    },
  );

  // ── Progress review and milestones (BP-04-003) ─────────────────────────────

  fastify.post(
    '/pgr/reviews',
    {
      schema: {
        body: Type.Object({
          enrolmentId:       Type.String(),
          reviewTypeCode:    Type.Union([
            Type.Literal('initial'), Type.Literal('annual'),
            Type.Literal('upgrade'), Type.Literal('return-from-interruption'),
          ]),
          ownerId:           Type.String(),
          supervisionCaseId: Type.Optional(Type.String()),
        }),
        response: { 201: Type.Object({ reviewId: Type.String() }), 422: ErrorSchema },
      },
      preHandler: [requirePermission('pgr-case:write')],
    },
    async (request, reply) => {
      const body = request.body as OpenReviewInput;
      const reviewId = await fastify.progressReviewService.openReview(request.tenantId, body, request.user.sub);

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'pgr_progress_review',
        entityId:         reviewId,
        actionType:       'create',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(201).send({ reviewId });
    },
  );

  fastify.get(
    '/pgr/reviews/:reviewId',
    {
      schema: {
        params:   Type.Object({ reviewId: Type.String() }),
        response: { 200: ProgressReviewSchema, 404: ErrorSchema },
      },
      preHandler: [requirePermission('pgr-case:read')],
    },
    async (request, reply) => {
      const { reviewId } = request.params as { reviewId: string };
      const review = await fastify.progressReviewService.getReview(request.tenantId, reviewId);
      await reply.send(reviewToWire(review));
    },
  );

  fastify.post(
    '/pgr/reviews/:reviewId/members',
    {
      schema: {
        params: Type.Object({ reviewId: Type.String() }),
        body: Type.Object({
          personId: Type.String(),
          roleCode: Type.Union([Type.Literal('chair'), Type.Literal('independent-reviewer'), Type.Literal('panel-member')]),
        }),
        response: { 201: Type.Object({ memberId: Type.String() }), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('pgr-case:write')],
    },
    async (request, reply) => {
      const { reviewId } = request.params as { reviewId: string };
      const body = request.body as AddReviewMemberInput;
      const memberId = await fastify.progressReviewService.addMember(request.tenantId, reviewId, body, request.user.sub);
      await reply.code(201).send({ memberId });
    },
  );

  fastify.get(
    '/pgr/reviews/:reviewId/members',
    {
      schema: {
        params:   Type.Object({ reviewId: Type.String() }),
        response: { 200: Type.Array(ReviewMemberSchema) },
      },
      preHandler: [requirePermission('pgr-case:read')],
    },
    async (request, reply) => {
      const { reviewId } = request.params as { reviewId: string };
      const members = await fastify.progressReviewService.listMembers(request.tenantId, reviewId);
      await reply.send(members.map(memberToWire));
    },
  );

  fastify.post(
    '/pgr/reviews/members/:memberId/conflict',
    {
      schema: {
        params: Type.Object({ memberId: Type.String() }),
        body:   Type.Object({ conflictTypeCode: Type.String() }),
        response: { 204: Type.Null(), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('pgr-case:write')],
    },
    async (request, reply) => {
      const { memberId } = request.params as { memberId: string };
      const { conflictTypeCode } = request.body as { conflictTypeCode: string };
      await fastify.progressReviewService.declareConflict(request.tenantId, memberId, conflictTypeCode);
      await reply.code(204).send();
    },
  );

  fastify.post(
    '/pgr/reviews/members/:memberId/recuse',
    {
      schema: {
        params:   Type.Object({ memberId: Type.String() }),
        response: { 204: Type.Null(), 404: ErrorSchema },
      },
      preHandler: [requirePermission('pgr-case:write')],
    },
    async (request, reply) => {
      const { memberId } = request.params as { memberId: string };
      await fastify.progressReviewService.recuseMember(request.tenantId, memberId);
      await reply.code(204).send();
    },
  );

  fastify.post(
    '/pgr/reviews/:reviewId/evidence',
    {
      schema: {
        params: Type.Object({ reviewId: Type.String() }),
        body: Type.Object({
          evidenceRef:        Type.String(),
          classificationCode: Type.String(),
          sourceSystem:       Type.String(),
        }),
        response: { 201: Type.Object({ evidenceId: Type.String() }), 404: ErrorSchema },
      },
      preHandler: [requirePermission('pgr-case:write')],
    },
    async (request, reply) => {
      const { reviewId } = request.params as { reviewId: string };
      const body = request.body as { evidenceRef: string; classificationCode: string; sourceSystem: string };
      const evidenceId = await fastify.progressReviewService.recordEvidence(request.tenantId, reviewId, {
        ...body,
        receivedBy: request.user.sub,
      });
      await reply.code(201).send({ evidenceId });
    },
  );

  fastify.post(
    '/pgr/reviews/:reviewId/outcome',
    {
      schema: {
        params: Type.Object({ reviewId: Type.String() }),
        body: Type.Object({
          outcomeCode: Type.Union([
            Type.Literal('satisfactory'), Type.Literal('conditions'), Type.Literal('referral'),
            Type.Literal('transfer'), Type.Literal('escalation'),
          ]),
          reasonText: Type.Optional(Type.String()),
        }),
        response: { 204: Type.Null(), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('pgr-case:decide')],
    },
    async (request, reply) => {
      const { reviewId } = request.params as { reviewId: string };
      const body = request.body as RecordOutcomeInput;
      await fastify.progressReviewService.recordOutcome(request.tenantId, reviewId, body, request.user.sub);

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'pgr_progress_review',
        entityId:         reviewId,
        actionType:       'update',
        fieldName:        'outcome_code',
        afterValue:       { outcomeCode: body.outcomeCode },
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(204).send();
    },
  );

  fastify.post(
    '/pgr/reviews/:reviewId/milestones',
    {
      schema: {
        params: Type.Object({ reviewId: Type.String() }),
        body: Type.Object({
          milestoneTypeCode: Type.Union([
            Type.Literal('confirmation-of-registration'), Type.Literal('upgrade'),
            Type.Literal('thesis-submission'), Type.Literal('viva'),
          ]),
          achievedDate: Type.String(),
        }),
        response: { 201: Type.Object({ milestoneId: Type.String() }), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('pgr-case:write')],
    },
    async (request, reply) => {
      const { reviewId } = request.params as { reviewId: string };
      const body = request.body as PublishMilestoneInput;
      const milestoneId = await fastify.progressReviewService.publishMilestone(request.tenantId, reviewId, body, request.user.sub);
      await reply.code(201).send({ milestoneId });
    },
  );

  fastify.get(
    '/enrolments/:enrolmentId/research-milestones',
    {
      schema: {
        params:   Type.Object({ enrolmentId: Type.String() }),
        response: { 200: Type.Array(MilestoneSchema) },
      },
      preHandler: [requirePermission('pgr-case:read')],
    },
    async (request, reply) => {
      const { enrolmentId } = request.params as { enrolmentId: string };
      const milestones = await fastify.progressReviewService.listMilestones(request.tenantId, enrolmentId);
      await reply.send(milestones.map(milestoneToWire));
    },
  );

  // ── Thesis submission and examination (BP-05-010) ──────────────────────────

  fastify.post(
    '/pgr/examinations',
    {
      schema: {
        body: Type.Object({
          enrolmentId:           Type.String(),
          ownerId:               Type.String(),
          formatCode:            Type.Union([Type.Literal('traditional'), Type.Literal('practice-based'), Type.Literal('published-work')]),
          declarationConfirmed:  Type.Boolean(),
          storageRef:            Type.String(),
          restricted:            Type.Optional(Type.Boolean()),
          restrictionReasonText: Type.Optional(Type.String()),
          restrictionReviewDate: Type.Optional(Type.String()),
        }),
        response: { 201: Type.Object({ examinationCaseId: Type.String(), submissionId: Type.String() }), 422: ErrorSchema },
      },
      preHandler: [requirePermission('pgr-case:write')],
    },
    async (request, reply) => {
      const body = request.body as SubmitThesisInput;
      const result = await fastify.examinationService.submitThesis(request.tenantId, body, request.user.sub);

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'pgr_examination_case',
        entityId:         result.examinationCaseId,
        actionType:       'create',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(201).send(result);
    },
  );

  fastify.get(
    '/pgr/examinations/:caseId',
    {
      schema: {
        params:   Type.Object({ caseId: Type.String() }),
        response: { 200: ExaminationCaseSchema, 404: ErrorSchema },
      },
      preHandler: [requirePermission('pgr-case:read')],
    },
    async (request, reply) => {
      const { caseId } = request.params as { caseId: string };
      const examinationCase = await fastify.examinationService.getExaminationCase(request.tenantId, caseId);
      await reply.send(examinationCaseToWire(examinationCase));
    },
  );

  fastify.get(
    '/pgr/examinations/:caseId/thesis-submission',
    {
      schema: {
        params:   Type.Object({ caseId: Type.String() }),
        response: { 200: ThesisSubmissionSchema, 404: ErrorSchema },
      },
      preHandler: [requirePermission('pgr-case:read')],
    },
    async (request, reply) => {
      const { caseId } = request.params as { caseId: string };
      const submission = await fastify.examinationService.getThesisSubmission(request.tenantId, caseId);
      await reply.send(thesisSubmissionToWire(submission));
    },
  );

  fastify.post(
    '/pgr/examinations/:caseId/examiners',
    {
      schema: {
        params: Type.Object({ caseId: Type.String() }),
        body: Type.Object({
          personId:         Type.String(),
          examinerRoleCode: Type.Union([Type.Literal('internal'), Type.Literal('external')]),
        }),
        response: { 201: Type.Object({ appointmentId: Type.String() }), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('pgr-case:write')],
    },
    async (request, reply) => {
      const { caseId } = request.params as { caseId: string };
      const body = request.body as NominateExaminerInput;
      const appointmentId = await fastify.examinationService.nominateExaminer(request.tenantId, caseId, body, request.user.sub);
      await reply.code(201).send({ appointmentId });
    },
  );

  fastify.get(
    '/pgr/examinations/:caseId/examiners',
    {
      schema: {
        params:   Type.Object({ caseId: Type.String() }),
        response: { 200: Type.Array(ExaminerAppointmentSchema) },
      },
      preHandler: [requirePermission('pgr-case:read')],
    },
    async (request, reply) => {
      const { caseId } = request.params as { caseId: string };
      const appointments = await fastify.examinationService.listExaminerAppointments(request.tenantId, caseId);
      await reply.send(appointments.map(appointmentToWire));
    },
  );

  fastify.post(
    '/pgr/examinations/examiners/:appointmentId/independence-check',
    {
      schema: {
        params:   Type.Object({ appointmentId: Type.String() }),
        response: { 204: Type.Null(), 404: ErrorSchema },
      },
      preHandler: [requirePermission('pgr-case:write')],
    },
    async (request, reply) => {
      const { appointmentId } = request.params as { appointmentId: string };
      await fastify.examinationService.recordIndependenceCheck(request.tenantId, appointmentId);
      await reply.code(204).send();
    },
  );

  fastify.post(
    '/pgr/examinations/examiners/:appointmentId/conflict',
    {
      schema: {
        params: Type.Object({ appointmentId: Type.String() }),
        body:   Type.Object({ conflictTypeCode: Type.String() }),
        response: { 204: Type.Null(), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('pgr-case:write')],
    },
    async (request, reply) => {
      const { appointmentId } = request.params as { appointmentId: string };
      const { conflictTypeCode } = request.body as { conflictTypeCode: string };
      await fastify.examinationService.declareConflict(request.tenantId, appointmentId, conflictTypeCode);
      await reply.code(204).send();
    },
  );

  fastify.post(
    '/pgr/examinations/examiners/:appointmentId/recuse',
    {
      schema: {
        params:   Type.Object({ appointmentId: Type.String() }),
        response: { 204: Type.Null(), 404: ErrorSchema },
      },
      preHandler: [requirePermission('pgr-case:write')],
    },
    async (request, reply) => {
      const { appointmentId } = request.params as { appointmentId: string };
      await fastify.examinationService.recuseExaminer(request.tenantId, appointmentId);
      await reply.code(204).send();
    },
  );

  fastify.post(
    '/pgr/examinations/:caseId/examiners/approve',
    {
      schema: {
        params:   Type.Object({ caseId: Type.String() }),
        response: { 204: Type.Null(), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('pgr-case:decide')],
    },
    async (request, reply) => {
      const { caseId } = request.params as { caseId: string };
      await fastify.examinationService.approveExaminerPanel(request.tenantId, caseId, request.user.sub);
      await reply.code(204).send();
    },
  );

  fastify.post(
    '/pgr/examinations/:caseId/examiner-reports',
    {
      schema: {
        params: Type.Object({ caseId: Type.String() }),
        body: Type.Object({
          examinerAppointmentId: Type.String(),
          reportRef:             Type.String(),
          recommendationCode:    Type.Optional(Type.String()),
        }),
        response: { 201: Type.Object({ reportId: Type.String() }), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('pgr-case:write')],
    },
    async (request, reply) => {
      const { caseId } = request.params as { caseId: string };
      const body = request.body as RecordExaminerReportInput;
      const reportId = await fastify.examinationService.recordExaminerReport(request.tenantId, caseId, body);
      await reply.code(201).send({ reportId });
    },
  );

  fastify.get(
    '/pgr/examinations/:caseId/examiner-reports',
    {
      schema: {
        params:   Type.Object({ caseId: Type.String() }),
        response: { 200: Type.Array(ExaminerReportSchema) },
      },
      preHandler: [requirePermission('pgr-case:read')],
    },
    async (request, reply) => {
      const { caseId } = request.params as { caseId: string };
      const reports = await fastify.examinationService.listExaminerReports(request.tenantId, caseId);
      await reply.send(reports.map(reportToWire));
    },
  );

  fastify.post(
    '/pgr/examinations/:caseId/viva',
    {
      schema: {
        params: Type.Object({ caseId: Type.String() }),
        body: Type.Object({
          heldAt:                  Type.String(),
          jointRecommendationText: Type.String(),
        }),
        response: { 201: Type.Object({ vivaEventId: Type.String() }), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('pgr-case:write')],
    },
    async (request, reply) => {
      const { caseId } = request.params as { caseId: string };
      const body = request.body as RecordVivaInput;
      const vivaEventId = await fastify.examinationService.recordViva(request.tenantId, caseId, body, request.user.sub);
      await reply.code(201).send({ vivaEventId });
    },
  );

  fastify.get(
    '/pgr/examinations/:caseId/viva',
    {
      schema: {
        params:   Type.Object({ caseId: Type.String() }),
        response: { 200: Type.Union([VivaEventSchema, Type.Null()]) },
      },
      preHandler: [requirePermission('pgr-case:read')],
    },
    async (request, reply) => {
      const { caseId } = request.params as { caseId: string };
      const viva = await fastify.examinationService.getViva(request.tenantId, caseId);
      await reply.send(viva ? vivaToWire(viva) : null);
    },
  );

  fastify.post(
    '/pgr/examinations/:caseId/outcome',
    {
      schema: {
        params: Type.Object({ caseId: Type.String() }),
        body: Type.Object({
          outcomeCode: Type.Union([
            Type.Literal('pass'), Type.Literal('pass-minor-corrections'), Type.Literal('pass-major-corrections'),
            Type.Literal('resubmission'), Type.Literal('fail'),
          ]),
          correctionsDeadline: Type.Optional(Type.String()),
        }),
        response: { 201: Type.Object({ outcomeId: Type.String() }), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('pgr-case:decide')],
    },
    async (request, reply) => {
      const { caseId } = request.params as { caseId: string };
      const body = request.body as RatifyOutcomeInput;
      const outcomeId = await fastify.examinationService.ratifyOutcome(request.tenantId, caseId, body, request.user.sub);

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'pgr_examination_outcome',
        entityId:         outcomeId,
        actionType:       'create',
        fieldName:        'outcome_code',
        afterValue:       { outcomeCode: body.outcomeCode },
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(201).send({ outcomeId });
    },
  );

  fastify.get(
    '/pgr/examinations/:caseId/outcome',
    {
      schema: {
        params:   Type.Object({ caseId: Type.String() }),
        response: { 200: Type.Union([ExaminationOutcomeSchema, Type.Null()]) },
      },
      preHandler: [requirePermission('pgr-case:read')],
    },
    async (request, reply) => {
      const { caseId } = request.params as { caseId: string };
      const outcome = await fastify.examinationService.getLatestOutcome(request.tenantId, caseId);
      await reply.send(outcome ? outcomeToWire(outcome) : null);
    },
  );

  fastify.get(
    '/pgr/examinations/outcomes/:outcomeId/corrections',
    {
      schema: {
        params:   Type.Object({ outcomeId: Type.String() }),
        response: { 200: Type.Array(CorrectionRequirementSchema) },
      },
      preHandler: [requirePermission('pgr-case:read')],
    },
    async (request, reply) => {
      const { outcomeId } = request.params as { outcomeId: string };
      const requirements = await fastify.examinationService.listCorrectionRequirements(request.tenantId, outcomeId);
      await reply.send(requirements.map(requirementToWire));
    },
  );

  fastify.post(
    '/pgr/examinations/corrections/:requirementId/complete',
    {
      schema: {
        params:   Type.Object({ requirementId: Type.String() }),
        response: { 204: Type.Null(), 404: ErrorSchema },
      },
      preHandler: [requirePermission('pgr-case:write')],
    },
    async (request, reply) => {
      const { requirementId } = request.params as { requirementId: string };
      await fastify.examinationService.recordCorrectionsComplete(request.tenantId, requirementId, request.user.sub);
      await reply.code(204).send();
    },
  );

  // ── Completion and award conferral (BP-06-006) ─────────────────────────────

  fastify.post(
    '/pgr/completions',
    {
      schema: {
        body: Type.Object({
          examinationCaseId: Type.String(),
          ownerId:           Type.String(),
        }),
        response: { 201: Type.Object({ completionCaseId: Type.String() }), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('pgr-case:write')],
    },
    async (request, reply) => {
      const body = request.body as OpenCompletionCaseInput;
      const completionCaseId = await fastify.completionService.openCompletionCase(request.tenantId, body, request.user.sub);

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'pgr_completion_case',
        entityId:         completionCaseId,
        actionType:       'create',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(201).send({ completionCaseId });
    },
  );

  fastify.get(
    '/pgr/completions/:completionCaseId',
    {
      schema: {
        params:   Type.Object({ completionCaseId: Type.String() }),
        response: { 200: CompletionCaseSchema, 404: ErrorSchema },
      },
      preHandler: [requirePermission('pgr-case:read')],
    },
    async (request, reply) => {
      const { completionCaseId } = request.params as { completionCaseId: string };
      const completionCase = await fastify.completionService.getCompletionCase(request.tenantId, completionCaseId);
      await reply.send(completionCaseToWire(completionCase));
    },
  );

  fastify.post(
    '/pgr/completions/:completionCaseId/deposit',
    {
      schema: {
        params: Type.Object({ completionCaseId: Type.String() }),
        body: Type.Object({
          depositRef:             Type.String(),
          ipDeclarationConfirmed: Type.Boolean(),
        }),
        response: { 201: Type.Object({ depositId: Type.String() }), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('pgr-case:write')],
    },
    async (request, reply) => {
      const { completionCaseId } = request.params as { completionCaseId: string };
      const body = request.body as RecordFinalDepositInput;
      const depositId = await fastify.completionService.recordFinalDeposit(request.tenantId, completionCaseId, body, request.user.sub);
      await reply.code(201).send({ depositId });
    },
  );

  fastify.get(
    '/pgr/completions/:completionCaseId/deposit',
    {
      schema: {
        params:   Type.Object({ completionCaseId: Type.String() }),
        response: { 200: Type.Union([FinalThesisDepositSchema, Type.Null()]) },
      },
      preHandler: [requirePermission('pgr-case:read')],
    },
    async (request, reply) => {
      const { completionCaseId } = request.params as { completionCaseId: string };
      const deposit = await fastify.completionService.getFinalDeposit(request.tenantId, completionCaseId);
      await reply.send(deposit ? depositToWire(deposit) : null);
    },
  );

  fastify.post(
    '/pgr/completions/:completionCaseId/complete',
    {
      schema: {
        params:   Type.Object({ completionCaseId: Type.String() }),
        response: { 204: Type.Null(), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('pgr-case:decide')],
    },
    async (request, reply) => {
      const { completionCaseId } = request.params as { completionCaseId: string };
      await fastify.completionService.recordCompletion(request.tenantId, completionCaseId, request.user.sub);

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'pgr_completion_case',
        entityId:         completionCaseId,
        actionType:       'update',
        fieldName:        'status_code',
        afterValue:       { statusCode: 'completed' },
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(204).send();
    },
  );

  fastify.post(
    '/pgr/completions/:completionCaseId/award',
    {
      schema: {
        params: Type.Object({ completionCaseId: Type.String() }),
        body: Type.Object({
          qualificationCode: Type.String({ minLength: 1 }),
          awardDate:         Type.String({ minLength: 1 }),
        }),
        response: { 201: Type.Object({ awardId: Type.String() }), 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('award:confer:research')],
    },
    async (request, reply) => {
      const { completionCaseId } = request.params as { completionCaseId: string };
      const body = request.body as ConferResearchAwardInput;
      const awardId = await fastify.completionService.conferAward(request.tenantId, completionCaseId, body, request.user.sub);

      await fastify.audit.record({
        tenantId:         request.tenantId,
        entityType:       'award',
        entityId:         awardId,
        actionType:       'create',
        actorType:        'user',
        actorId:          request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId:    request.id,
      });

      await reply.code(201).send({ awardId });
    },
  );
}

function completionCaseToWire(completionCase: CompletionCaseDto) {
  return {
    ...completionCase,
    createdAt: completionCase.createdAt.toISOString(),
  };
}

function depositToWire(deposit: FinalThesisDepositDto) {
  return {
    ...deposit,
    confirmedAt: deposit.confirmedAt.toISOString(),
  };
}

function caseToWire(supervisionCase: SupervisionCaseDto) {
  return {
    ...supervisionCase,
    createdAt: supervisionCase.createdAt.toISOString(),
  };
}

function nominationToWire(nomination: SupervisorNominationDto) {
  return {
    ...nomination,
    eligibilityCheckedAt: nomination.eligibilityCheckedAt?.toISOString() ?? null,
    nominatedAt:          nomination.nominatedAt.toISOString(),
  };
}

function assignmentToWire(assignment: StaffAssignmentDto) {
  return {
    ...assignment,
    validFrom: assignment.validFrom.toISOString(),
    validTo:   assignment.validTo?.toISOString() ?? null,
  };
}

function reviewToWire(review: ProgressReviewDto) {
  return {
    ...review,
    createdAt: review.createdAt.toISOString(),
  };
}

function memberToWire(member: ReviewMemberDto) {
  return {
    ...member,
    declaredAt: member.declaredAt?.toISOString() ?? null,
    recusedAt:  member.recusedAt?.toISOString() ?? null,
  };
}

function milestoneToWire(milestone: ResearchMilestoneDto) {
  return {
    ...milestone,
    publishedAt: milestone.publishedAt?.toISOString() ?? null,
  };
}

function examinationCaseToWire(examinationCase: ExaminationCaseDto) {
  return {
    ...examinationCase,
    createdAt: examinationCase.createdAt.toISOString(),
  };
}

function thesisSubmissionToWire(submission: ThesisSubmissionDto) {
  return {
    ...submission,
    submittedAt: submission.submittedAt.toISOString(),
  };
}

function appointmentToWire(appointment: ExaminerAppointmentDto) {
  return {
    ...appointment,
    independenceCheckedAt: appointment.independenceCheckedAt?.toISOString() ?? null,
    recusedAt:             appointment.recusedAt?.toISOString() ?? null,
    confirmedAt:           appointment.confirmedAt?.toISOString() ?? null,
  };
}

function reportToWire(report: ExaminerReportDto) {
  return {
    ...report,
    submittedAt: report.submittedAt.toISOString(),
  };
}

function vivaToWire(viva: VivaEventDto) {
  return {
    ...viva,
    heldAt:     viva.heldAt.toISOString(),
    recordedAt: viva.recordedAt.toISOString(),
  };
}

function outcomeToWire(outcome: ExaminationOutcomeDto) {
  return {
    ...outcome,
    decidedAt: outcome.decidedAt.toISOString(),
  };
}

function requirementToWire(requirement: CorrectionRequirementDto) {
  return {
    ...requirement,
    completedAt: requirement.completedAt?.toISOString() ?? null,
  };
}
