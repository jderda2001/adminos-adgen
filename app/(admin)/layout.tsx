import { requireAdmin } from "@/lib/auth";
import { logoutAction } from "@/app/login/actions";
import { AppSidebar } from "@/components/app-sidebar";
import { ForcePasswordChange } from "@/components/force-password-change";

// Layout panelu administracyjnego — dostęp wyłącznie dla roli ADMIN,
// egzekwowany serwerowo (pracownik jest przekierowany do /moj-czas).
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAdmin();

  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar userName={user.name} logoutAction={logoutAction} />
      <main className="min-w-0 flex-1 px-6 py-6 lg:px-8">
        <div className="mx-auto max-w-[1400px]">
          {user.mustChangePassword ? <ForcePasswordChange /> : children}
        </div>
      </main>
    </div>
  );
}
