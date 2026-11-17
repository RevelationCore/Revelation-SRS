import { Type } from '@sinclair/typebox';
import { requireAnyPermission, requirePermission } from '@revelation-srs/auth';
import type { CurriculumBindingChange } from '@revelation-srs/db';
import { ValidationError, hasPermission } from '@revelation-srs/domain';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type {
  AddProposalItemInput,
  CreateModuleGroupInput,
  CreateProposalInput,
  ModuleGroupDto,
  ProposalDto,
} from '../platform/module-selection/service.js';

import { PendingDecisionSchema, pendingDecision } from './workflow-decision-response.js';

const ValidationMessageSchema = Type.Object({
  ruleTypeCode: Type.String(),
  message: Type.String(),
  severity: Type.Union([Type.Literal('error'), Type.Literal('warning')]),
});

const ProposalItemSchema = Type.Object({
  proposalItemId: Type.String(),
  moduleId: Type.String(),
  moduleCode: Type.String(),
  moduleTitle: Type.String(),
  creditValue: Type.Union([Type.Number(), Type.Null()]),
  fheqLevel: Type.Union([Type.Number(), Type.Null()]),
  moduleOfferingId: Type.Union([Type.String(), Type.Null()]),
  preferenceRank: Type.Union([Type.Number(), Type.Null()]),
  choiceSlot: Type.Union([Type.Number(), Type.Null()]),
  reassessmentPlanId: Type.Union([Type.String(), Type.Null()]),
  isReplacement: Type.Boolean(),
  heldUntil: Type.Union([Type.String(), Type.Null()]),
  sourceCode: Type.String(),
  validationStateCode: Type.String(),
  validationMessages: Type.Array(ValidationMessageSchema),
});

const ProposalSchema = Type.Object({
  moduleSelectionProposalId: Type.String(),
  enrolmentId: Type.String(),
  academicPeriodId: Type.String(),
  programmeRuleSetId: Type.String(),
  statusCode: Type.String(),
  submittedAt: Type.Union([Type.String(), Type.Null()]),
  decidedAt: Type.Union([Type.String(), Type.Null()]),
  decisionAuthorityCode: Type.Union([Type.String(), Type.Null()]),
  decisionReason: Type.Union([Type.String(), Type.Null()]),
  workflowInstanceId: Type.Union([Type.String(), Type.Null()]),
  fheqLevel: Type.Union([Type.Number(), Type.Null()]),
  lateSubmissionReasonCode: Type.Union([Type.String(), Type.Null()]),
  lateSubmittedBy: Type.Union([Type.String(), Type.Null()]),
  items: Type.Array(ProposalItemSchema),
});

const ModuleGroupMemberSchema = Type.Object({
  moduleGroupMemberId: Type.String(),
  moduleId: Type.String(),
  moduleCode: Type.String(),
  moduleTitle: Type.String(),
  isDefault: Type.Boolean(),
  isNonCondonable: Type.Boolean(),
});

const ModuleGroupSchema = Type.Object({
  moduleGroupId: Type.String(),
  programmeRuleSetId: Type.String(),
  fheqLevel: Type.Union([Type.Number(), Type.Null()]),
  groupCode: Type.String(),
  title: Type.String(),
  groupTypeCode: Type.String(),
  minModules: Type.Union([Type.Number(), Type.Null()]),
  maxModules: Type.Union([Type.Number(), Type.Null()]),
  minCredits: Type.Union([Type.Number(), Type.Null()]),
  maxCredits: Type.Union([Type.Number(), Type.Null()]),
  minFheqLevel: Type.Union([Type.Number(), Type.Null()]),
  maxFheqLevel: Type.Union([Type.Number(), Type.Null()]),
  members: Type.Array(ModuleGroupMemberSchema),
});

const ErrorSchema = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Number(),
  detail: Type.Optional(Type.String()),
});

export function moduleSelectionProposalsRoutes(fastify: FastifyInstance): void {
  // ── Proposals ────────────────────────────────────────────────────────────────

  fastify.get(
    '/module-selection-proposals',
    {
      schema: {
        querystring: Type.Object({
          enrolmentId: Type.Optional(Type.String()),
          statusCode: Type.Optional(Type.String()),
        }),
        response: { 200: Type.Array(ProposalSchema), 403: ErrorSchema },
      },
      preHandler: [requireAnyPermission('module-selection:read:own', 'module-selection:read:all')],
    },
    async (request, reply) => {
      const query = request.query as { enrolmentId?: string; statusCode?: string };

      if (request.user.srsPersonId && !request.user.roles.some((r) => ['registry-administrator', 'personal-tutor', 'programme-approver'].includes(r))) {
        if (!query.enrolmentId) {
          return reply.code(403).send(forbidden(request.url, 'Students must specify their own enrolmentId'));
        }
        const enrolment = await fastify.enrolmentService.getEnrolment(query.enrolmentId, request.tenantId);
        if (!enrolment || enrolment.personId !== request.user.srsPersonId) {
          return reply.code(403).send(forbidden(request.url, 'You may only view proposals within your own enrolment'));
        }
      }

      const opts: { enrolmentId?: string; statusCode?: string } = {};
      if (query.enrolmentId !== undefined) opts.enrolmentId = query.enrolmentId;
      if (query.statusCode !== undefined) opts.statusCode = query.statusCode;

      const proposals = await fastify.moduleSelectionService.listProposals(request.tenantId, opts);
      await reply.send(proposals.map(proposalToWire));
    },
  );

  fastify.post(
    '/module-selection-proposals',
    {
      schema: {
        body: Type.Object({
          enrolmentId: Type.String(),
          academicPeriodId: Type.String(),
          fheqLevel: Type.Number(),
        }),
        response: {
          201: Type.Object({ moduleSelectionProposalId: Type.String() }),
          403: ErrorSchema,
          404: ErrorSchema,
          422: ErrorSchema,
        },
      },
      preHandler: [requireAnyPermission('module-selection:write:own', 'module-selection:read:all')],
    },
    async (request, reply) => {
      const body = request.body as CreateProposalInput;

      if (request.user.srsPersonId && !request.user.roles.includes('registry-administrator')) {
        const enrolment = await fastify.enrolmentService.getEnrolment(body.enrolmentId, request.tenantId);
        if (!enrolment || enrolment.personId !== request.user.srsPersonId) {
          return reply.code(403).send(forbidden(request.url, 'You may only create proposals within your own enrolment'));
        }
      }

      const moduleSelectionProposalId = await fastify.moduleSelectionService.createProposal(
        request.tenantId, body, request.user.sub,
      );

      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'module_selection_proposal',
        entityId: moduleSelectionProposalId,
        actionType: 'create',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });

      await reply.code(201).send({ moduleSelectionProposalId });
    },
  );

  fastify.get(
    '/module-selection-proposals/:proposalId',
    {
      schema: {
        params: Type.Object({ proposalId: Type.String() }),
        response: { 200: ProposalSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
      preHandler: [requireAnyPermission('module-selection:read:own', 'module-selection:read:all')],
    },
    async (request, reply) => {
      const { proposalId } = request.params as { proposalId: string };
      const proposal = await fastify.moduleSelectionService.getProposal(proposalId, request.tenantId);
      if (!proposal) {
        return reply.code(404).send(notFound(`ModuleSelectionProposal '${proposalId}' not found`));
      }
      if (request.user.srsPersonId && !request.user.roles.some((r) => ['registry-administrator', 'personal-tutor', 'programme-approver'].includes(r))) {
        const enrolment = await fastify.enrolmentService.getEnrolment(proposal.enrolmentId, request.tenantId);
        if (!enrolment || enrolment.personId !== request.user.srsPersonId) {
          return reply.code(403).send(forbidden(request.url, 'You may only view your own proposals'));
        }
      }
      await reply.send(proposalToWire(proposal));
    },
  );

  fastify.post(
    '/module-selection-proposals/:proposalId/items',
    {
      schema: {
        params: Type.Object({ proposalId: Type.String() }),
        body: Type.Object({
          moduleId: Type.String(),
          moduleOfferingId: Type.Optional(Type.String()),
          preferenceRank: Type.Optional(Type.Number()),
          sourceCode: Type.Optional(Type.Union([Type.Literal('student-choice'), Type.Literal('staff-assisted')])),
          choiceSlot: Type.Optional(Type.Integer({ minimum: 1 })),
          replacesReassessmentPlanId: Type.Optional(Type.String()),
        }),
        response: {
          201: Type.Object({ proposalItemId: Type.String() }),
          403: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
      preHandler: [requireAnyPermission('module-selection:write:own', 'module-selection:read:all')],
    },
    async (request, reply) => {
      const { proposalId } = request.params as { proposalId: string };
      const body = request.body as AddProposalItemInput;
      if (!(await ensureOwnProposalOrStaff(fastify, request, reply, proposalId))) return;
      const proposalItemId = await fastify.moduleSelectionService.addItem(request.tenantId, proposalId, body);
      await reply.code(201).send({ proposalItemId });
    },
  );

  fastify.delete(
    '/module-selection-proposals/:proposalId/items/:proposalItemId',
    {
      schema: {
        params: Type.Object({ proposalId: Type.String(), proposalItemId: Type.String() }),
        response: { 204: Type.Null(), 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema },
      },
      preHandler: [requireAnyPermission('module-selection:write:own', 'module-selection:read:all')],
    },
    async (request, reply) => {
      const { proposalId, proposalItemId } = request.params as { proposalId: string; proposalItemId: string };
      if (!(await ensureOwnProposalOrStaff(fastify, request, reply, proposalId))) return;
      await fastify.moduleSelectionService.removeItem(request.tenantId, proposalId, proposalItemId);
      await reply.code(204).send();
    },
  );

  fastify.get(
    '/module-selection-proposals/:proposalId/validation',
    {
      schema: {
        params: Type.Object({ proposalId: Type.String() }),
        response: {
          200: Type.Object({
            valid: Type.Boolean(),
            capacityConflict: Type.Boolean(),
            messages: Type.Array(Type.Object({
              ruleTypeCode: Type.String(), message: Type.String(), severity: Type.String(),
              proposalItemId: Type.Union([Type.String(), Type.Null()]),
            })),
          }),
          403: ErrorSchema, 404: ErrorSchema,
        },
      },
      preHandler: [requireAnyPermission('module-selection:read:own', 'module-selection:read:all')],
    },
    async (request, reply) => {
      const { proposalId } = request.params as { proposalId: string };
      if (!(await ensureOwnProposalOrStaff(fastify, request, reply, proposalId))) return;
      await reply.send(await fastify.moduleSelectionService.previewValidation(request.tenantId, proposalId));
    },
  );

  // ── Module subject areas (D-27) ────────────────────────────────────────────
  const SubjectShares = Type.Array(Type.Object({ subjectAreaCode: Type.String({ minLength: 1 }), proportionPercent: Type.Integer({ minimum: 1, maximum: 100 }) }));
  fastify.get('/modules/:moduleId/subjects', {
    schema: { params: Type.Object({ moduleId: Type.String() }), response: { 200: SubjectShares } },
    preHandler: [requireAnyPermission('module-selection:read:all', 'module-selection:configure')],
  }, async (request, reply) => {
    const { moduleId } = request.params as { moduleId: string };
    await reply.send(await fastify.moduleSubjectService.list(request.tenantId, moduleId));
  });
  fastify.put('/modules/:moduleId/subjects', {
    schema: { params: Type.Object({ moduleId: Type.String() }), body: SubjectShares, response: { 200: SubjectShares, 404: ErrorSchema, 422: ErrorSchema } },
    preHandler: [requirePermission('module-selection:configure')],
  }, async (request, reply) => {
    const { moduleId } = request.params as { moduleId: string };
    const shares = await fastify.moduleSubjectService.replace(request.tenantId, moduleId, request.body as Array<{ subjectAreaCode: string; proportionPercent: number }>);
    await fastify.audit.record({
      tenantId: request.tenantId, entityType: 'module_subject', entityId: moduleId, actionType: 'update', afterValue: shares,
      actorType: 'user', actorId: request.user.sub, actorDisplayName: request.user.displayName, correlationId: request.id,
    });
    await reply.send(shares);
  });

  /** The student's own allocation outcome and order position (D-30). */
  fastify.get('/module-selection-proposals/:proposalId/allocation', {
    schema: {
      params: Type.Object({ proposalId: Type.String() }),
      response: {
        200: Type.Union([Type.Null(), Type.Object({
          allocationRunId: Type.String(), orderPosition: Type.Integer(),
          results: Type.Array(Type.Object({ choiceSlot: Type.Union([Type.Integer(), Type.Null()]), outcomeCode: Type.String(), allocatedItemId: Type.Union([Type.String(), Type.Null()]), reason: Type.Union([Type.String(), Type.Null()]) })),
        })]),
        403: ErrorSchema, 404: ErrorSchema,
      },
    },
    preHandler: [requireAnyPermission('module-selection:read:own', 'module-selection:read:all')],
  }, async (request, reply) => {
    const { proposalId } = request.params as { proposalId: string };
    if (!(await ensureOwnProposalOrStaff(fastify, request, reply, proposalId))) return;
    await reply.send(await fastify.allocationService.outcomeFor(request.tenantId, proposalId));
  });

  fastify.post(
    '/module-selection-proposals/:proposalId/submission',
    {
      schema: {
        params: Type.Object({ proposalId: Type.String() }),
        // Optional body { lateSubmission: { reasonCode, note } }: staff with module-selection:submit:late may submit
        // outside the window (D-29). No body schema, so a bodiless submission is accepted; checked below.
        response: { 200: ProposalSchema, 403: ErrorSchema, 404: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requireAnyPermission('module-selection:write:own', 'module-selection:read:all')],
    },
    async (request, reply) => {
      const { proposalId } = request.params as { proposalId: string };
      if (!(await ensureOwnProposalOrStaff(fastify, request, reply, proposalId))) return;
      const late = (request.body as { lateSubmission?: { reasonCode?: unknown; note?: unknown } } | null | undefined)?.lateSubmission;
      if (late && (typeof late.reasonCode !== 'string' || typeof late.note !== 'string' || !late.reasonCode || !late.note.trim())) {
        throw new ValidationError('A late submission needs a reasonCode and a note');
      }
      if (late) {
        if (!hasPermission(request.user.roles, 'module-selection:submit:late')) {
          await reply.code(403).send({ type: 'about:blank', title: 'Forbidden', status: 403, detail: 'Late submission needs module-selection:submit:late' });
          return;
        }
        if ((await fastify.valueSetService.validateFieldValue('module_selection_proposal', 'late_submission_reason_code', late.reasonCode as string, request.tenantId)) === false) {
          throw new ValidationError(`Invalid late submission reason '${String(late.reasonCode)}'`);
        }
      }
      const proposal = await fastify.moduleSelectionService.submitProposal(request.tenantId, proposalId, request.user.sub, late as { reasonCode: string; note: string } | undefined);

      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'module_selection_proposal',
        entityId: proposalId,
        fieldName: 'status_code',
        afterValue: { statusCode: proposal.statusCode },
        actionType: 'update',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });

      await reply.send(proposalToWire(proposal));
    },
  );

  fastify.post(
    '/module-selection-proposals/:proposalId/decision',
    {
      schema: {
        params: Type.Object({ proposalId: Type.String() }),
        body: Type.Object({
          decisionCode: Type.Union([Type.Literal('approved'), Type.Literal('rejected'), Type.Literal('returned')]),
          reason: Type.String(),
        }),
        response: { 200: ProposalSchema, 202: PendingDecisionSchema, 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('module-selection:decide')],
    },
    async (request, reply) => {
      const { proposalId } = request.params as { proposalId: string };
      const body = request.body as { decisionCode: 'approved' | 'rejected' | 'returned'; reason: string };
      const proposal = await fastify.moduleSelectionService.decideProposal(
        request.tenantId, proposalId, body.decisionCode, request.user.sub, body.reason,
      );

      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'module_selection_proposal',
        entityId: proposalId,
        fieldName: 'status_code',
        afterValue: { statusCode: proposal.statusCode, decisionCode: body.decisionCode, reason: body.reason },
        actionType: 'update',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });

      if (proposal.decisionStatus === 'pending') {
        await reply.code(202).send(pendingDecision(proposal.commandId));
        return;
      }
      await reply.send(proposalToWire(proposal));
    },
  );

  // ── Curriculum binding ───────────────────────────────────────────────────────

  fastify.get(
    '/enrolment-curriculum-bindings/:enrolmentId',
    {
      schema: {
        params: Type.Object({ enrolmentId: Type.String() }),
        response: {
          200: Type.Object({
            enrolmentCurriculumBindingId: Type.String(),
            enrolmentId: Type.String(),
            programmeRouteId: Type.Union([Type.String(), Type.Null()]),
            programmeRuleSetId: Type.String(),
            decisionAuthorityCode: Type.String(),
            decisionReason: Type.Union([Type.String(), Type.Null()]),
            changeReasonCode: Type.Union([Type.String(), Type.Null()]),
          }),
          404: ErrorSchema,
        },
      },
      preHandler: [requirePermission('curriculum-binding:read')],
    },
    async (request, reply) => {
      const { enrolmentId } = request.params as { enrolmentId: string };
      const binding = await fastify.moduleSelectionService.getCurriculumBinding(request.tenantId, enrolmentId);
      if (!binding) return reply.code(404).send(notFound(`No curriculum binding for enrolment '${enrolmentId}'`));
      await reply.send(binding);
    },
  );

  const BindingChangeSchema = Type.Object({
    curriculumBindingChangeId: Type.String(), enrolmentId: Type.String(),
    programmeRouteId: Type.Union([Type.String(), Type.Null()]), programmeRuleSetId: Type.String(),
    changeReasonCode: Type.String(), reason: Type.String(), effectiveDate: Type.String(), statusCode: Type.String(),
    proposedBy: Type.String(), proposedAt: Type.String(),
    decidedBy: Type.Union([Type.String(), Type.Null()]), decidedAt: Type.Union([Type.String(), Type.Null()]), decisionReason: Type.Union([Type.String(), Type.Null()]),
  });
  const changeToWire = (c: CurriculumBindingChange) => {
    const { id, tenantId: _t, ...rest } = c;
    return { curriculumBindingChangeId: id, ...rest, proposedAt: c.proposedAt.toISOString(), decidedAt: c.decidedAt?.toISOString() ?? null };
  };

  // Changing one student's binding (D-11): applied at once when nothing depends
  // on it yet, otherwise proposed for a programme approver's decision.
  fastify.post(
    '/enrolment-curriculum-bindings/:enrolmentId',
    {
      schema: {
        params: Type.Object({ enrolmentId: Type.String() }),
        body: Type.Object({
          programmeRouteId: Type.Optional(Type.String()),
          programmeRuleSetId: Type.String(),
          changeReasonCode: Type.String({ minLength: 1 }),
          reason: Type.String({ minLength: 1, maxLength: 2000 }),
          effectiveDate: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
        }),
        response: { 201: Type.Object({ applied: Type.Boolean(), change: BindingChangeSchema }), 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
      },
      preHandler: [requirePermission('curriculum-binding:write')],
    },
    async (request, reply) => {
      const { enrolmentId } = request.params as { enrolmentId: string };
      const { change, applied } = await fastify.bindingChangeService.proposeBindingChange(request.tenantId, enrolmentId, request.body as never, request.user.sub);
      await fastify.audit.record({
        tenantId: request.tenantId, entityType: 'curriculum_binding_change', entityId: change.id, actionType: 'create', actorType: 'user',
        actorId: request.user.sub, actorDisplayName: request.user.displayName, correlationId: request.id,
        reasonText: applied ? 'Curriculum binding changed' : 'Curriculum binding change proposed',
      });
      await reply.code(201).send({ applied, change: changeToWire(change) });
    },
  );

  fastify.get(
    '/curriculum-binding-changes',
    {
      schema: {
        querystring: Type.Object({ enrolmentId: Type.Optional(Type.String()), pending: Type.Optional(Type.Boolean()) }),
        response: { 200: Type.Array(Type.Composite([BindingChangeSchema, Type.Object({ subject: Type.Optional(Type.Object({
          personId: Type.String(), studentNumber: Type.String(), studentName: Type.String(),
          programmeCode: Type.Union([Type.String(), Type.Null()]), programmeTitle: Type.Union([Type.String(), Type.Null()]),
        })) })])) },
      },
      preHandler: [requirePermission('curriculum-binding:read')],
    },
    async (request, reply) => {
      const { enrolmentId, pending } = request.query as { enrolmentId?: string; pending?: boolean };
      const rows = await fastify.bindingChangeService.listBindingChanges(request.tenantId, { ...(enrolmentId ? { enrolmentId } : {}), pendingOnly: pending ?? false });
      const subjects = await fastify.statusCaseService.subjects(request.tenantId, rows.map((r) => r.enrolmentId));
      await reply.send(rows.map((r) => ({ ...changeToWire(r), subject: subjects.get(r.enrolmentId) })));
    },
  );

  fastify.post(
    '/curriculum-binding-changes/:changeId/decision',
    {
      schema: {
        params: Type.Object({ changeId: Type.String() }),
        body: Type.Object({ decisionCode: Type.Union([Type.Literal('approved'), Type.Literal('rejected')]), reason: Type.String({ minLength: 1, maxLength: 2000 }) }),
        response: { 200: BindingChangeSchema, 404: ErrorSchema, 409: ErrorSchema },
      },
      preHandler: [requirePermission('curriculum-binding:approve')],
    },
    async (request, reply) => {
      const { changeId } = request.params as { changeId: string };
      const decided = await fastify.bindingChangeService.decideBindingChange(request.tenantId, changeId, request.body as never, request.user.sub);
      await fastify.audit.record({
        tenantId: request.tenantId, entityType: 'curriculum_binding_change', entityId: changeId, actionType: 'update', actorType: 'user',
        actorId: request.user.sub, actorDisplayName: request.user.displayName, correlationId: request.id, reasonText: `Binding change ${decided.statusCode}`,
      });
      await reply.send(changeToWire(decided));
    },
  );

  fastify.get(
    '/programme-rule-sets',
    {
      schema: {
        querystring: Type.Object({ programmeId: Type.String() }),
        response: {
          200: Type.Array(Type.Object({
            programmeRuleSetId: Type.String(),
            programmeId: Type.String(),
            programmeRouteId: Type.Union([Type.String(), Type.Null()]),
            entryAcademicYear: Type.Union([Type.String(), Type.Null()]),
            ruleSetCode: Type.String(),
            description: Type.Union([Type.String(), Type.Null()]),
          })),
        },
      },
      preHandler: [requireAnyPermission('catalogue:read', 'module-selection:configure')],
    },
    async (request, reply) => {
      const { programmeId } = request.query as { programmeId: string };
      const ruleSets = await fastify.moduleSelectionService.listProgrammeRuleSets(request.tenantId, programmeId);
      await reply.send(ruleSets);
    },
  );

  fastify.post(
    '/programme-rule-sets',
    {
      schema: {
        body: Type.Object({
          programmeId: Type.String(),
          programmeRouteId: Type.Optional(Type.String()),
          entryAcademicYear: Type.Optional(Type.String()),
          ruleSetCode: Type.String(),
          description: Type.Optional(Type.String()),
        }),
        response: { 201: Type.Object({ programmeRuleSetId: Type.String() }) },
      },
      preHandler: [requirePermission('module-selection:configure')],
    },
    async (request, reply) => {
      const body = request.body as {
        programmeId: string; programmeRouteId?: string; entryAcademicYear?: string;
        ruleSetCode: string; description?: string;
      };
      const programmeRuleSetId = await fastify.moduleSelectionService.createProgrammeRuleSet(request.tenantId, body);

      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'programme_rule_set',
        entityId: programmeRuleSetId,
        actionType: 'create',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });

      await reply.code(201).send({ programmeRuleSetId });
    },
  );

  // ── Module diet groups ───────────────────────────────────────────────────────

  fastify.get(
    '/module-groups',
    {
      schema: {
        querystring: Type.Object({ programmeRuleSetId: Type.String() }),
        response: { 200: Type.Array(ModuleGroupSchema) },
      },
      preHandler: [requireAnyPermission('catalogue:read', 'module-selection:configure')],
    },
    async (request, reply) => {
      const { programmeRuleSetId } = request.query as { programmeRuleSetId: string };
      const groups = await fastify.moduleSelectionService.listModuleGroups(request.tenantId, programmeRuleSetId);
      await reply.send(groups.map(moduleGroupToWire));
    },
  );

  fastify.post(
    '/module-groups',
    {
      schema: {
        body: Type.Object({
          programmeRuleSetId: Type.String(),
          fheqLevel: Type.Optional(Type.Number()),
          groupCode: Type.String(),
          title: Type.String(),
          groupTypeCode: Type.Union([Type.Literal('compulsory'), Type.Literal('optional-pool'), Type.Literal('elective-pool')]),
          minModules: Type.Optional(Type.Number()),
          maxModules: Type.Optional(Type.Number()),
          minCredits: Type.Optional(Type.Number()),
          maxCredits: Type.Optional(Type.Number()),
          minFheqLevel: Type.Optional(Type.Number()),
          maxFheqLevel: Type.Optional(Type.Number()),
        }),
        response: { 201: Type.Object({ moduleGroupId: Type.String() }) },
      },
      preHandler: [requirePermission('module-selection:configure')],
    },
    async (request, reply) => {
      const body = request.body as CreateModuleGroupInput;
      const moduleGroupId = await fastify.moduleSelectionService.createModuleGroup(request.tenantId, body);

      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'module_group',
        entityId: moduleGroupId,
        actionType: 'create',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });

      await reply.code(201).send({ moduleGroupId });
    },
  );

  fastify.post(
    '/module-groups/:moduleGroupId/members',
    {
      schema: {
        params: Type.Object({ moduleGroupId: Type.String() }),
        body: Type.Object({
          moduleId: Type.String(),
          isDefault: Type.Optional(Type.Boolean()),
          isNonCondonable: Type.Optional(Type.Boolean()),
          /** Counts the module's whole credit towards one subject area in this diet (D-27). */
          countsTowardsSubjectAreaCode: Type.Optional(Type.String()),
        }),
        response: { 201: Type.Object({ moduleGroupMemberId: Type.String() }), 422: ErrorSchema },
      },
      preHandler: [requirePermission('module-selection:configure')],
    },
    async (request, reply) => {
      const { moduleGroupId } = request.params as { moduleGroupId: string };
      const body = request.body as { moduleId: string; isDefault?: boolean; isNonCondonable?: boolean; countsTowardsSubjectAreaCode?: string };
      if (body.countsTowardsSubjectAreaCode && (await fastify.valueSetService.validateFieldValue('module_group_member', 'counts_towards_subject_area_code', body.countsTowardsSubjectAreaCode, request.tenantId)) === false) {
        throw new ValidationError(`Unknown subject area '${body.countsTowardsSubjectAreaCode}'`);
      }
      const moduleGroupMemberId = await fastify.moduleSelectionService.addModuleGroupMember(request.tenantId, moduleGroupId, body);

      await fastify.audit.record({
        tenantId: request.tenantId,
        entityType: 'module_group_member',
        entityId: moduleGroupMemberId,
        actionType: 'create',
        actorType: 'user',
        actorId: request.user.sub,
        actorDisplayName: request.user.displayName,
        correlationId: request.id,
      });

      await reply.code(201).send({ moduleGroupMemberId });
    },
  );
}

/**
 * Students may only act on proposals within their own enrolment. Returns
 * `true` once the caller may proceed; otherwise it has already sent the
 * appropriate 403/404 response and the caller must return immediately.
 */
async function ensureOwnProposalOrStaff(
  fastify: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  proposalId: string,
): Promise<boolean> {
  if (!request.user.srsPersonId || request.user.roles.includes('registry-administrator')) return true;

  const proposal = await fastify.moduleSelectionService.getProposal(proposalId, request.tenantId);
  if (!proposal) {
    await reply.code(404).send(notFound(`ModuleSelectionProposal '${proposalId}' not found`));
    return false;
  }
  const enrolment = await fastify.enrolmentService.getEnrolment(proposal.enrolmentId, request.tenantId);
  if (!enrolment || enrolment.personId !== request.user.srsPersonId) {
    await reply.code(403).send(forbidden(request.url, 'You may only act on proposals within your own enrolment'));
    return false;
  }
  return true;
}

function forbidden(instance: string, detail: string) {
  return { type: 'https://srs.example.com/errors/forbidden', title: 'Forbidden', status: 403, detail, instance };
}

function notFound(detail: string) {
  return { type: 'https://srs.example.com/errors/not-found', title: 'Not Found', status: 404, detail };
}

function proposalToWire(proposal: ProposalDto) {
  return {
    ...proposal,
    submittedAt: proposal.submittedAt ? new Date(proposal.submittedAt).toISOString() : null,
    decidedAt: proposal.decidedAt ? new Date(proposal.decidedAt).toISOString() : null,
    items: proposal.items.map((i) => ({ ...i, heldUntil: i.heldUntil ? new Date(i.heldUntil).toISOString() : null })),
  };
}

function moduleGroupToWire(group: ModuleGroupDto) {
  return group;
}
