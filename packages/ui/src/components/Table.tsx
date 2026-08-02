import type { HTMLAttributes, ReactNode, TableHTMLAttributes } from 'react';

export function Table({ className = '', children, ...rest }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table className={`min-w-full divide-y divide-neutral-200 ${className}`} {...rest}>
        {children}
      </table>
    </div>
  );
}

export function TableHead({ children }: { children: ReactNode }) {
  return <thead className="bg-neutral-50">{children}</thead>;
}

export function TableHeaderCell({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <th
      scope="col"
      className={`px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-neutral-500 ${className}`}
    >
      {children}
    </th>
  );
}

export function TableBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-neutral-100 bg-white">{children}</tbody>;
}

export function TableRow({ className = '', children, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={`hover:bg-neutral-50 ${className}`} {...rest}>
      {children}
    </tr>
  );
}

export function TableCell({ className = '', children }: { className?: string; children: ReactNode }) {
  return <td className={`px-4 py-3 text-sm text-neutral-700 ${className}`}>{children}</td>;
}

export function TableEmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-neutral-500">
        {children}
      </td>
    </tr>
  );
}
