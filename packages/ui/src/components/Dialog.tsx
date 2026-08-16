import * as RadixDialog from '@radix-ui/react-dialog';
import { forwardRef, useEffect, useRef } from 'react';

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

export const DialogOverlay = forwardRef<HTMLDivElement, { className?: string }>(function DialogOverlay({ className = '' }, ref) {
  return (
    <RadixDialog.Overlay
      ref={ref}
      className={`fixed inset-0 bg-black/30 z-40 ${className}`}
    />
  );
});

// ─── Styled content panel ─────────────────────────────────────────────────────

interface DialogContentProps {
  children: React.ReactNode;
  className?: string;
  /** aria-describedby value; required when no DialogDescription is rendered. */
  'aria-describedby'?: string;
  onCloseAutoFocus?: (event: Event) => void;
}

export const DialogContent = forwardRef<HTMLDivElement, DialogContentProps>(function DialogContent({ children, className = '', ...rest }, ref) {
  return (
    <RadixDialog.Content
      ref={ref}
      className={`fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2
        rounded-xl bg-white shadow-popover border border-neutral-200 p-6 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600 focus-visible:-outline-offset-2 ${className}`}
      {...rest}
    >
      {children}
    </RadixDialog.Content>
  );
});

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
  // Radix's own focus-return-on-close only fires via its DialogTrigger; this
  // component is driven by external open/onOpenChange state from an arbitrary
  // triggering control instead, so Radix's default onCloseAutoFocus handler
  // (which unconditionally preventDefaults the generic restore, then focuses
  // a trigger ref that is always null here) would otherwise drop focus to
  // <body> on every close. Capture and restore it ourselves.
  const previouslyFocused = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) previouslyFocused.current = document.activeElement as HTMLElement | null;
  }, [open]);

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent
          aria-describedby={description ? 'dialog-description' : undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            previouslyFocused.current?.focus();
          }}
        >
          <DialogTitle className="text-base font-semibold text-neutral-900 mb-4">
            {title}
          </DialogTitle>
          {description && (
            <DialogDescription id="dialog-description" className="text-sm text-neutral-600 mb-4">
              {description}
            </DialogDescription>
          )}
          {children}
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  );
}
