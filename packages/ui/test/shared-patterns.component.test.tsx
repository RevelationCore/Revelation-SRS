import { useForm } from 'react-hook-form';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { Dialog } from '../src/components/Dialog.js';
import { StatusNotice } from '../src/components/StatusNotice.js';
import { Table, TableBody, TableEmptyRow } from '../src/components/Table.js';
import { Field } from '../src/form/Field.js';

function RequiredField() {
  const { register } = useForm();
  return <Field label="Student number" registration={register('studentNumber')} required error={{ type: 'required', message: 'Student number is required' }} />;
}

describe('shared form, dialog and status patterns', () => {
  it('associates a required field with its alert', async () => {
    const { container } = render(<RequiredField />);
    expect(screen.getByLabelText(/Student number/)).toHaveAccessibleDescription('Student number is required');
    expect(screen.getByRole('alert')).toHaveTextContent('Student number is required');
    await expectNoA11yViolations(container);
  });

  it('closes a confirmation dialog with Escape', async () => {
    const onOpenChange = vi.fn();
    const { container } = render(<Dialog open onOpenChange={onOpenChange} title="Confirm decision" description="This changes the authoritative record"><button>Confirm</button></Dialog>);
    expect(screen.getByRole('dialog', { name: 'Confirm decision' })).toBeVisible();
    await expectNoA11yViolations(container);
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('announces successful mutations and accessible empty tables', async () => {
    const { container } = render(<><StatusNotice>Request submitted for approval.</StatusNotice><Table><TableBody><TableEmptyRow colSpan={2}>No requests</TableEmptyRow></TableBody></Table></>);
    expect(screen.getByRole('status')).toHaveTextContent('Request submitted');
    expect(screen.getByRole('table')).toHaveTextContent('No requests');
    await expectNoA11yViolations(container);
  });
});
