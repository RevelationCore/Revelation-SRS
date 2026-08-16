import * as RadixTabs from '@radix-ui/react-tabs';

export const Tabs = RadixTabs.Root;

export function TabsList({ className = '', ...rest }: RadixTabs.TabsListProps) {
  return (
    <RadixTabs.List
      className={`flex gap-1 border-b border-neutral-200 ${className}`}
      {...rest}
    />
  );
}

export function TabsTrigger({ className = '', ...rest }: RadixTabs.TabsTriggerProps) {
  return (
    <RadixTabs.Trigger
      className={[
        'border-b-2 border-transparent px-3 py-2 text-sm font-medium text-neutral-500',
        'hover:text-neutral-700',
        'data-[state=active]:border-primary-600 data-[state=active]:text-primary-700',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600',
        className,
      ].join(' ')}
      {...rest}
    />
  );
}

export function TabsContent({ className = '', ...rest }: RadixTabs.TabsContentProps) {
  return (
    <RadixTabs.Content
      className={`pt-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600 focus-visible:-outline-offset-2 ${className}`}
      {...rest}
    />
  );
}
