export function ChartLoadingState() {
  return (
    <div className="flex h-[280px] items-center justify-center rounded-md border border-line bg-surface-2">
      <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-ink-4 border-t-transparent" />
    </div>
  );
}

export function ChartErrorState({ error }) {
  return (
    <div className="min-h-[120px] max-h-[280px] overflow-y-auto rounded-md border border-red-200 bg-red-50 p-6">
      <p className="text-center font-body text-body text-red-600">
        ERROR: {error}
      </p>
    </div>
  );
}
