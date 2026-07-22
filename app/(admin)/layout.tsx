import { isAuthDisabled, requireAdmin } from "@/lib/auth";
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
      <AppSidebar
        userName={user.name}
        logoutAction={logoutAction}
        showLogout={!isAuthDisabled()}
      />
      {/* pt na mobile robi miejsce na stały górny pasek (h-14); na desktopie
          standardowy padding. px węższe na telefonie dla większej szerokości treści. */}
      <main className="min-w-0 flex-1 px-4 pb-10 pt-[4.5rem] sm:px-6 lg:px-8 lg:py-6">
        <div className="mx-auto max-w-[1400px]">
          {user.mustChangePassword ? <ForcePasswordChange /> : children}
        </div>
      </main>
    </div>
  );
}
