"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  LineChart,
  ChartSpline,
  Banknote,
  Receipt,
  CreditCard,
  TrendingUp,
  Building2,
  Users,
  Settings,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
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
      { href: "/estymacje", label: "Estymacje", icon: ChartSpline },
    ],
  },
  {
    label: "Finanse",
    items: [
      { href: "/finanse/przychody", label: "Przychody", icon: Banknote },
      { href: "/finanse/koszty", label: "Koszty", icon: Receipt },
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

const COLLAPSE_KEY = "adgen-sidebar-collapsed";

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
  const [collapsed, setCollapsed] = useState(false);

  // preferencja zwinięcia zapamiętana lokalnie (bez migotania: czytamy po montażu)
  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
  }, []);
  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  }

  const isActive = (item: NavItem) =>
    pathname === item.href ||
    pathname.startsWith((item.match ?? item.href) + "/") ||
    pathname === (item.match ?? item.href);

  const itemClass = (active: boolean) =>
    cn(
      "flex items-center rounded-lg text-sm font-medium transition-colors",
      collapsed ? "justify-center px-0 py-2" : "gap-3 px-2.5 py-2",
      active
        ? "bg-sidebar-accent text-sidebar-accent-foreground"
        : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
    );

  return (
    <aside
      className={cn(
        "sticky top-0 flex h-screen shrink-0 flex-col border-r bg-sidebar transition-[width] duration-200",
        collapsed ? "w-16" : "w-60"
      )}
    >
      <div className={cn("flex h-16 items-center", collapsed ? "justify-center px-2" : "px-5")}>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            {/* logo adGen — ciemne na jasnym tle, jasne (białe) na ciemnym */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/4.png" alt="adGen" className="h-[22px] w-auto dark:hidden" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/3.png" alt="adGen" className="hidden h-[22px] w-auto dark:block" />
            <div className="mt-1 text-[11px] leading-none text-muted-foreground">Finanse</div>
          </div>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Rozwiń menu" : "Zwiń menu"}
          title={collapsed ? "Rozwiń menu" : "Zwiń menu"}
          className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
        >
          {collapsed ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}
        </button>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            {collapsed ? (
              <div className="mx-2 mb-1.5 border-t" />
            ) : (
              <div className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {group.label}
              </div>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(item);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    className={itemClass(active)}
                  >
                    <item.icon
                      className={cn("size-[18px] shrink-0", active ? "text-primary" : "text-muted-foreground")}
                    />
                    {!collapsed && item.label}
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
          title={collapsed ? "Ustawienia" : undefined}
          className={itemClass(pathname.startsWith("/ustawienia"))}
        >
          <Settings
            className={cn(
              "size-[18px] shrink-0",
              pathname.startsWith("/ustawienia") ? "text-primary" : "text-muted-foreground"
            )}
          />
          {!collapsed && "Ustawienia"}
        </Link>

        <div
          className={cn(
            "mt-1 flex items-center rounded-lg border bg-card",
            collapsed ? "justify-center px-1 py-2" : "gap-2.5 px-2.5 py-2"
          )}
        >
          <div
            className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary"
            title={collapsed ? userName : undefined}
          >
            {initials(userName)}
          </div>
          {!collapsed && (
            <>
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
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
