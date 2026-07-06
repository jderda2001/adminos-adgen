import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { todayUTC } from "@/lib/format";
import { effectiveRateGr } from "@/lib/calc";
import { PageHeader } from "@/components/page-header";
import { TeamTable, type MemberRow } from "./team-table";

export const metadata: Metadata = { title: "Zespół" };

export default async function TeamPage() {
  const admin = await requireAdmin();

  const users = await db.user.findMany({
    include: { rates: { orderBy: { validFrom: "desc" } } },
    orderBy: { name: "asc" },
  });

  const today = todayUTC();
  const rows: MemberRow[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    active: u.active,
    currentRateGr: effectiveRateGr(u.rates, today),
    rates: u.rates.map((r) => ({
      id: r.id,
      ratePerHourGr: r.ratePerHourGr,
      validFrom: r.validFrom.toISOString(),
    })),
  }));

  return (
    <>
      <PageHeader
        title="Zespół"
        description="Pracownicy, role dostępu i stawki kosztowe (zł/h) do wyceny czasu pracy"
      />
      <TeamTable members={rows} currentUserId={admin.id} />
    </>
  );
}
