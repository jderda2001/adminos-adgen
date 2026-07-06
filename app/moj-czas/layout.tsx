import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { logoutAction } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { ForcePasswordChange } from "@/components/force-password-change";

// Panel czasu pracy — dostępny dla każdego zalogowanego użytkownika.
// Pracownik widzi WYŁĄCZNIE ten obszar; admin ma dodatkowo link powrotny.
export default async function MyTimeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b bg-background px-4 md:px-6">
        <div className="flex items-center gap-4">
          <span className="font-semibold tracking-tight">
            adGen <span className="text-muted-foreground">Finanse</span>
          </span>
          <span className="text-sm text-muted-foreground">Mój czas</span>
        </div>
        <div className="flex items-center gap-3">
          {user.role === "ADMIN" && (
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard">Panel administracyjny</Link>
            </Button>
          )}
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {user.name}
          </span>
          <form action={logoutAction}>
            <Button type="submit" variant="ghost" size="sm" className="gap-2">
              <LogOut className="size-4" />
              Wyloguj
            </Button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl p-4 md:p-6">
        {user.mustChangePassword ? <ForcePasswordChange /> : children}
      </main>
    </div>
  );
}
