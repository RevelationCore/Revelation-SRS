import { useEffect, useState } from 'react';
import { getFieldValueSet, type FieldValueSet } from '../api/valueSets.js';
import { ApiError } from '../api/client.js';

interface ValueSetState {
  members:  FieldValueSet['members'];
  loading:  boolean;
  error:    string;
}

/**
 * Fetches the value-set members for a domain entity field.
 * The result is stable after the first successful load.
 */
export function useValueSet(entity: string, field: string): ValueSetState {
  const [members, setMembers] = useState<FieldValueSet['members']>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getFieldValueSet(entity, field)
      .then(vs => { if (!cancelled) { setMembers(vs.members); setLoading(false); } })
      .catch(e  => { if (!cancelled) { setError(e instanceof ApiError ? e.message : 'Failed to load'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [entity, field]);

  return { members, loading, error };
}
