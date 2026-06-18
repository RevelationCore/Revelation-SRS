import * as RadixDialog from '@radix-ui/react-dialog';

// ─── Composition exports ───────────────────────────────────────────────────────
// Re-export the Radix primitives directly so consumers can compose them freely.
// The styled variants below cover the common "modal with heading + body" pattern.

export const DialogRoot        = RadixDialog.Root;
export const DialogTrigger     = RadixDialog.Trigger;
export const DialogClose       = RadixDialog.Close;
export const DialogPortal      = RadixDialog.Portal;
export const DialogTitle       = RadixDialog.Title;
export const DialogDescription = RadixDialog.Description;

// ─── Styled overlay ───────────────────────────────────────────────────────────

export function DialogOverlay({ className = '' }: { className?: string }) {
  return (
    <RadixDialog.Overlay
      className={`fixed inset-0 bg-black/30 z-40 ${className}`}
    />
  );
}

// ─── Styled content panel ─────────────────────────────────────────────────────

interface DialogContentProps {
  children: React.ReactNode;
  className?: string;
  /** aria-describedby value; required when no DialogDescription is rendered. */
  'aria-describedby'?: string;
}

export function DialogContent({ children, className = '', ...rest }: DialogContentProps) {
  return (
    <RadixDialog.Content
      className={`fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2
        rounded-lg bg-white shadow-xl border border-gray-200 p-6 focus:outline-none ${className}`}
      {...rest}
    >
      {children}
    </RadixDialog.Content>
  );
}

// ─── Compound helper: full modal ─────────────────────────────────────────────
//
// Usage:
//   <Dialog open={open} onOpenChange={setOpen} title="New student">
//     <form ...>...</form>
//   </Dialog>

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}

export function Dialog({ open, onOpenChange, title, description, children }: DialogProps) {
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent aria-describedby={description ? 'dialog-description' : undefined}>
          <DialogTitle className="text-base font-semibold text-gray-900 mb-4">
            {title}
          </DialogTitle>
          {description && (
            <DialogDescription id="dialog-description" className="text-sm text-gray-600 mb-4">
              {description}
            </DialogDescription>
          )}
          {children}
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  );
}
