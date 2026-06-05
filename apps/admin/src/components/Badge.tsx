const STATUS_COLOURS: Record<string, string> = {
  // Enrolment statuses
  enrolled:     'bg-green-100  text-green-800',
  intermitting: 'bg-yellow-100 text-yellow-800',
  suspended:    'bg-orange-100 text-orange-800',
  withdrawn:    'bg-red-100    text-red-800',
  graduated:    'bg-blue-100   text-blue-800',
  // Person statuses
  prospective:  'bg-gray-100   text-gray-700',
  student:      'bg-green-100  text-green-800',
  alumnus:      'bg-purple-100 text-purple-800',
  deceased:     'bg-red-100    text-red-800',
  merged:       'bg-gray-100   text-gray-500',
  // Registration statuses
  registered:   'bg-green-100  text-green-800',
  completed:    'bg-blue-100   text-blue-800',
};

export function Badge({ value }: { value: string }) {
  const colour = STATUS_COLOURS[value] ?? 'bg-gray-100 text-gray-700';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colour}`}>
      {value}
    </span>
  );
}
