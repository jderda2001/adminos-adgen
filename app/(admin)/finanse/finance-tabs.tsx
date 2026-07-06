"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/finanse/przychody", label: "Przychody" },
  { href: "/finanse/koszty", label: "Koszty" },
];

export function FinanceTabs() {
  const pathname = usePathname();
  const active =
    TABS.find((tab) => pathname.startsWith(tab.href))?.href ??
    "/finanse/przychody";
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border bg-card p-1 shadow-[var(--shadow-card)]">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={cn(
            "rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors",
            active === tab.href
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
