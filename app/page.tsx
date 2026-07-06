import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";

export default async function HomePage() {
  const user = await requireUser();
  redirect(user.role === "ADMIN" ? "/dashboard" : "/moj-czas");
}
