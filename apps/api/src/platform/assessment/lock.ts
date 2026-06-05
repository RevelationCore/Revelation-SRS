import { ForbiddenError } from '@revelation-srs/domain';

export function assertNotLocked(entity: { locked: boolean }, entityType: string, id: string): void {
  if (entity.locked) {
    throw new ForbiddenError(`${entityType} '${id}' is locked and cannot be mutated outside the correction workflow`);
  }
}
