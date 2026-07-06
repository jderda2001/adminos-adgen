import { cn } from "@/lib/utils";

/** Pusty stan z instrukcją co zrobić */
export function EmptyState({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed bg-card px-6 py-16 text-center",
        className
      )}
    >
      <h3 className="text-base font-medium">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        {description}
      </p>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
