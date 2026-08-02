interface ProblemProps {
  title:   string;
  detail?: string;
  status?: number;
}

export function Problem({ title, detail, status }: ProblemProps) {
  return (
    <div role="alert" className="rounded-md border border-danger-200 bg-danger-50 p-4">
      <h2 className="text-sm font-semibold text-danger-800">
        {status !== undefined && (
          <span className="font-mono mr-2 text-danger-600">{status}</span>
        )}
        {title}
      </h2>
      {detail && <p className="mt-1 text-sm text-danger-700">{detail}</p>}
    </div>
  );
}
