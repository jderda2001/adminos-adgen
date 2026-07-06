import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { ClientsTable, type ClientRow } from "./clients-table";

export const metadata: Metadata = { title: "Klienci" };

export default async function ClientsPage() {
  await requireAdmin();

  const clients = await db.client.findMany({ orderBy: { name: "asc" } });

  const rows: ClientRow[] = clients.map((c) => ({
    id: c.id,
    name: c.name,
    nip: c.nip,
    contactPerson: c.contactPerson,
    email: c.email,
    phone: c.phone,
    address: c.address,
    billingModel: c.billingModel,
    monthlyRetainerGr: c.monthlyRetainerGr,
    offerTags: c.offerTags,
    status: c.status,
    startDate: c.startDate?.toISOString() ?? null,
    notes: c.notes,
  }));

  return (
    <>
      <PageHeader
        title="Klienci"
        description="Baza klientów agencji — modele rozliczeń, abonamenty i statusy współpracy"
      />
      <ClientsTable clients={rows} />
    </>
  );
}
