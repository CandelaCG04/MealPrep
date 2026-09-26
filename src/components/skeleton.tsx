/** Grey placeholders shown while a page's data is on its way, so a tap feels instant. */

export function Bar({ className = "" }: { className?: string }) {
  return <div className={`h-4 rounded bg-border ${className}`} />;
}

export function TitleBar() {
  return <Bar className="h-8 w-40" />;
}

/** A card with rows, like the pantry, shopping and recipe lists. */
export function RowsCard({ rows = 5 }: { rows?: number }) {
  return (
    <div className="card divide-y divide-border p-0">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-4">
          <Bar className="h-5 w-5 shrink-0 rounded-full" />
          <Bar className={i % 3 === 0 ? "w-2/5" : i % 3 === 1 ? "w-3/5" : "w-1/2"} />
        </div>
      ))}
    </div>
  );
}

export function StatsRow() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="card flex flex-col gap-2">
          <Bar className="h-8 w-12" />
          <Bar className="w-24" />
        </div>
      ))}
    </div>
  );
}

/** Wraps a page's placeholders: everything inside pulses gently. */
export function Skeleton({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-hidden>
      {children}
    </div>
  );
}
