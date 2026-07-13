import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";

export default async function HomePage() {
  await requireUser();
  // moduł czasu pracy usunięty — aplikacja jest w całości panelem finansowym
  redirect("/dashboard");
}
