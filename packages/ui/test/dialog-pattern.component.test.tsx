import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../../test/axe.mjs';
import { Dialog } from '../src/components/Dialog.js';

function DestructiveDialogExample() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(true)}>Delete record</button>
      <Dialog open={open} onOpenChange={setOpen} title="Delete this record?" description="This action cannot be undone.">
        <div className="flex justify-end gap-3">
          <button onClick={() => setOpen(false)}>Cancel</button>
          <button className="bg-danger-600 text-white" onClick={() => setOpen(false)}>Delete</button>
        </div>
      </Dialog>
    </div>
  );
}

describe('Dialog pattern — focus management and destructive confirmation', () => {
  it('moves initial focus into the dialog when it opens', async () => {
    render(<DestructiveDialogExample />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete record' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this record?' });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await expectNoA11yViolations(document.body);
  });

  it('traps Tab focus within the dialog rather than escaping to the page behind it', async () => {
    render(<DestructiveDialogExample />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete record' }));
    const dialog = await screen.findByRole('dialog');

    // Tab through every focusable control in the dialog and one more: focus
    // must still be inside the dialog, never on the trigger button behind it.
    for (let i = 0; i < 4; i++) await userEvent.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it('distinguishes cancel from the destructive action, and cancel closes without side effects', async () => {
    render(<DestructiveDialogExample />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete record' }));
    await screen.findByRole('dialog');

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('returns focus to the triggering control when the dialog closes', async () => {
    render(<DestructiveDialogExample />);
    const trigger = screen.getByRole('button', { name: 'Delete record' });
    await userEvent.click(trigger);
    await screen.findByRole('dialog');

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
