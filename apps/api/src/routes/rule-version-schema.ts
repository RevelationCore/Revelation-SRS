import { Type } from '@sinclair/typebox';

const Nullable = <T extends ReturnType<typeof Type.String>>(t: T) => Type.Union([t, Type.Null()]);

/** One rule a calculation used (Phase 5 D-35). */
export const RuleVersionSchema = Type.Object({
  ruleTypeCode: Type.String(),
  ruleKey:      Nullable(Type.String()),
  ruleId:       Nullable(Type.String()),
  versionId:    Nullable(Type.String()),
  programmeId:  Nullable(Type.String()),
  validFrom:    Nullable(Type.String()),
  source:       Type.String({ description: 'programme | tenant-default | exception | component-override | built-in-default | reassessment-plan' }),
  value:        Type.Unknown(),
  exceptionId:  Type.Optional(Type.String()),
  componentId:  Type.Optional(Type.String()),
  planId:       Type.Optional(Type.String()),
});
