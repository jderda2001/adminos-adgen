import { FinanceTabs } from "./finance-tabs";

// Finanse: wspólny nagłówek z podzakładkami Przychody | Koszty
export default function FinanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Finanse</h1>
        <FinanceTabs />
      </div>
      {children}
    </div>
  );
}
