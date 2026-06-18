import { randomUUID } from 'node:crypto';

/**
 * Bi-directional map between source external IDs and generated SRS UUIDs.
 *
 * Each external ID receives exactly one UUID per import run. Resolved IDs
 * are stored so that later phases can look up the generated UUIDs for FK
 * references without querying the database.
 */
export class IdMap {
  private readonly map = new Map<string, string>();

  resolve(externalId: string): string {
    const existing = this.map.get(externalId);
    if (existing !== undefined) return existing;
    const id = randomUUID();
    this.map.set(externalId, id);
    return id;
  }

  get(externalId: string): string | undefined {
    return this.map.get(externalId);
  }

  has(externalId: string): boolean {
    return this.map.has(externalId);
  }

  size(): number {
    return this.map.size;
  }
}
