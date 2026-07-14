"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  LineChart,
  Wallet,
  CreditCard,
  TrendingUp,
  Building2,
  Users,
  Settings,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  match?: string;
};

// Moduł czasu pracy jest tymczasowo ukryty z nawigacji (docelowo integracja z Clockify).
// Trasy /czas-pracy i /moj-czas nadal działają, po prostu nie linkujemy ich w menu.
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Przegląd",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/rachunek-wynikow", label: "Rachunek wyników", icon: LineChart },
    ],
  },
  {
    label: "Finanse",
    items: [
      { href: "/finanse/przychody", label: "Przychody i koszty", icon: Wallet, match: "/finanse" },
      { href: "/platnosci", label: "Płatności", icon: CreditCard },
      { href: "/rentownosc", label: "Rentowność", icon: TrendingUp },
    ],
  },
  {
    label: "Baza",
    items: [
      { href: "/klienci", label: "Klienci", icon: Building2 },
      { href: "/zespol", label: "Zespół", icon: Users },
    ],
  },
];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function AppSidebar({
  userName,
  logoutAction,
  showLogout = true,
}: {
  userName: string;
  logoutAction: () => Promise<void>;
  /** false gdy logowanie wyłączone (AUTH_DISABLED — sieć zamknięta) */
  showLogout?: boolean;
}) {
  const pathname = usePathname();

  const isActive = (item: NavItem) =>
    pathname === item.href || pathname.startsWith((item.match ?? item.href) + "/") || pathname === (item.match ?? item.href);

  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r bg-sidebar">
      <div className="flex h-16 items-center px-5">
        <div>
          {/* logo adGen — ciemne na jasnym tle, jasne (białe) na ciemnym */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/4.png" alt="adGen" className="h-[22px] w-auto dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/3.png" alt="adGen" className="hidden h-[22px] w-auto dark:block" />
          <div className="mt-1 text-[11px] leading-none text-muted-foreground">
            Finanse
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <div className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(item);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                    )}
                  >
                    <item.icon
                      className={cn(
                        "size-[18px]",
                        active ? "text-primary" : "text-muted-foreground"
                      )}
                    />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="space-y-1 px-3 pb-3">
        <Link
          href="/ustawienia"
          className={cn(
            "flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
            pathname.startsWith("/ustawienia")
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
          )}
        >
          <Settings
            className={cn(
              "size-[18px]",
              pathname.startsWith("/ustawienia")
                ? "text-primary"
                : "text-muted-foreground"
            )}
          />
          Ustawienia
        </Link>

        <div className="mt-1 flex items-center gap-2.5 rounded-lg border bg-card px-2.5 py-2">
          <div className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
            {initials(userName)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium">{userName}</div>
          </div>
          {showLogout && (
            <form action={logoutAction}>
              <button
                type="submit"
                aria-label="Wyloguj się"
                title="Wyloguj się"
                className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <LogOut className="size-4" />
              </button>
            </form>
          )}
        </div>
      </div>
    </aside>
  );
}
