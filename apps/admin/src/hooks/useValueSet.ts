import { useCodes, type CodeMember } from '@revelation-srs/ui';

interface ValueSetState {
  /** What a picker offers: selectable values (active, not hidden), in order. */
  members:  CodeMember[];
  /** Every value, retired and hidden too — for labelling records. */
  all:      CodeMember[];
  /** A code's label (the institution's wording); the code itself if unknown. */
  label:    (code: string | null | undefined) => string;
  loading:  boolean;
  error:    string;
}

/**
 * The value set for a data-model field, loaded once per field and shared
 * (see CodeSetProvider). Use `members` for pickers and `label` for display,
 * so a record holding a retired or hidden value still shows its label.
 */
export function useValueSet(entity: string, field: string): ValueSetState {
  const codes = useCodes(entity, field);
  return {
    members: codes.options,
    all:     codes.members,
    label:   codes.label,
    loading: codes.loading,
    error:   codes.missing ? 'Failed to load' : '',
  };
}
