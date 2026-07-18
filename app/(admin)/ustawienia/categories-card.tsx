"use client";

import { useState, useTransition } from "react";
import { Check, Megaphone, PiggyBank, Plus, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/status-badge";
import { SettingsCard } from "./settings-card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { pluralPl } from "@/lib/format";
import {
  createCategoryAction,
  deleteCategoryAction,
  renameCategoryAction,
  toggleAdBudgetCategoryAction,
  toggleDeferredCategoryAction,
  toggleSalaryCategoryAction,
} from "./actions";

export interface CategoryRow {
  id: string;
  name: string;
  costsCount: number;
  recurringCount: number;
  isSalary: boolean; // kategoria wynagrodzeń — poza kosztami bezpośrednimi i alokacją
  isAdBudget: boolean; // budżet reklamowy — poza direct/alokacją; klientom liczony koszt leadów
  isDeferred: boolean; // odłożone — transfer wewnętrzny (poduszka/inwestycje/CIT), poza zyskiem i zobowiązaniami
}

const SALARY_TOOLTIP =
  "Rozliczana kosztem pracy z godzin — poza kosztami bezpośrednimi i alokacją w rentowności";
const ADBUDGET_TOOLTIP =
  "Budżet reklamowy — koszty poza kosztami bezpośrednimi i alokacją; klientom przypisywany jest koszt leadów z modułu Leady";
const DEFERRED_TOOLTIP =
  "Odłożona — transfer na własne konto (poduszka, inwestycje, zaliczki CIT). Poza zyskiem/rentownością i poza zobowiązaniami do zapłaty";

function usageLabel(c: CategoryRow): string {
  const parts = [
    `${c.costsCount} ${pluralPl(c.costsCount, "koszt", "koszty", "kosztów")}`,
  ];
  if (c.recurringCount > 0) {
    parts.push(
      `${c.recurringCount} ${pluralPl(
        c.recurringCount,
        "szablon",
        "szablony",
        "szablonów"
      )}`
    );
  }
  return parts.join(" · ");
}

function CategoryItem({
  category,
  onDelete,
}: {
  category: CategoryRow;
  onDelete: (category: CategoryRow) => void;
}) {
  const [name, setName] = useState(category.name);
  const [pending, startTransition] = useTransition();
  const changed = name.trim() !== category.name && name.trim() !== "";
  const usage = category.costsCount + category.recurringCount;

  function handleRename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!changed) return;
    const formData = new FormData();
    formData.set("name", name);
    startTransition(async () => {
      const result = await renameCategoryAction(category.id, formData);
      if (result.ok) {
        toast.success(result.message);
        setName(name.trim());
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleToggleSalary(next: boolean) {
    startTransition(async () => {
      const result = await toggleSalaryCategoryAction(category.id, next);
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
    });
  }

  function handleToggleAdBudget(next: boolean) {
    startTransition(async () => {
      const result = await toggleAdBudgetCategoryAction(category.id, next);
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
    });
  }

  function handleToggleDeferred(next: boolean) {
    startTransition(async () => {
      const result = await toggleDeferredCategoryAction(category.id, next);
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
    });
  }

  function handleDeleteClick() {
    if (usage > 0) {
      toast.error(
        `Nie można usunąć kategorii używanej przez ${usage} ${pluralPl(
          usage,
          "koszt",
          "koszty",
          "kosztów"
        )}`
      );
      return;
    }
    onDelete(category);
  }

  return (
    <form onSubmit={handleRename} className="flex items-center gap-2 py-1.5">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="h-8 flex-1"
        aria-label={`Nazwa kategorii ${category.name}`}
      />
      {category.isSalary && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help">
              <StatusBadge tone="indigo">
                <Wallet className="size-3" /> wynagrodzenia
              </StatusBadge>
            </span>
          </TooltipTrigger>
          <TooltipContent>{SALARY_TOOLTIP}</TooltipContent>
        </Tooltip>
      )}
      {category.isAdBudget && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help">
              <StatusBadge tone="blue">
                <Megaphone className="size-3" /> budżet reklamowy
              </StatusBadge>
            </span>
          </TooltipTrigger>
          <TooltipContent>{ADBUDGET_TOOLTIP}</TooltipContent>
        </Tooltip>
      )}
      {category.isDeferred && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help">
              <StatusBadge tone="amber">
                <PiggyBank className="size-3" /> odłożona
              </StatusBadge>
            </span>
          </TooltipTrigger>
          <TooltipContent>{DEFERRED_TOOLTIP}</TooltipContent>
        </Tooltip>
      )}
      <span className="w-36 shrink-0 text-right text-xs text-muted-foreground">
        {usageLabel(category)}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex shrink-0 items-center">
            <Switch
              checked={category.isSalary}
              onCheckedChange={handleToggleSalary}
              disabled={pending}
              aria-label={`Oznacz „${category.name}” jako kategorię wynagrodzeń`}
            />
          </div>
        </TooltipTrigger>
        <TooltipContent>{SALARY_TOOLTIP}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex shrink-0 items-center">
            <Switch
              checked={category.isAdBudget}
              onCheckedChange={handleToggleAdBudget}
              disabled={pending}
              aria-label={`Oznacz „${category.name}” jako budżet reklamowy`}
            />
          </div>
        </TooltipTrigger>
        <TooltipContent>{ADBUDGET_TOOLTIP}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex shrink-0 items-center">
            <Switch
              checked={category.isDeferred}
              onCheckedChange={handleToggleDeferred}
              disabled={pending}
              aria-label={`Oznacz „${category.name}” jako odłożoną`}
            />
          </div>
        </TooltipTrigger>
        <TooltipContent>{DEFERRED_TOOLTIP}</TooltipContent>
      </Tooltip>
      <div className="flex w-16 shrink-0 justify-end gap-1">
        <Button
          type="submit"
          variant="ghost"
          size="icon-sm"
          disabled={!changed || pending}
          aria-label="Zapisz nazwę"
          title="Zapisz nazwę"
        >
          <Check className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={handleDeleteClick}
          disabled={pending}
          aria-label="Usuń kategorię"
          title="Usuń kategorię"
        >
          <Trash2 className="size-4 text-destructive" />
        </Button>
      </div>
    </form>
  );
}

export function CategoriesCard({ categories }: { categories: CategoryRow[] }) {
  const [newName, setNewName] = useState("");
  const [toDelete, setToDelete] = useState<CategoryRow | null>(null);
  const [pending, startTransition] = useTransition();

  function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData();
    formData.set("name", newName);
    startTransition(async () => {
      const result = await createCategoryAction(formData);
      if (result.ok) {
        toast.success(result.message);
        setNewName("");
      } else {
        toast.error(result.error);
      }
    });
  }

  function confirmDelete() {
    if (!toDelete) return;
    startTransition(async () => {
      const result = await deleteCategoryAction(toDelete.id);
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
      setToDelete(null);
    });
  }

  return (
    <SettingsCard
      title="Kategorie kosztów"
      description="Słownik kategorii używany przy kosztach i szablonach kosztów cyklicznych. Kategorii z przypisanymi kosztami nie można usunąć. Przełącznik „wynagrodzenia” wyłącza kategorię z kosztów bezpośrednich i alokacji w rentowności."
    >
      <TooltipProvider>
        <div className="divide-y divide-border/60">
          {categories.map((c) => (
            <CategoryItem key={c.id} category={c} onDelete={setToDelete} />
          ))}
        </div>
      </TooltipProvider>

      <form
        onSubmit={handleCreate}
        className="mt-4 flex items-center gap-2 border-t pt-4"
      >
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Nowa kategoria, np. hosting"
          className="h-8 flex-1"
          aria-label="Nazwa nowej kategorii"
        />
        <Button
          type="submit"
          size="sm"
          disabled={pending || newName.trim() === ""}
        >
          <Plus className="size-4" /> Dodaj
        </Button>
      </form>

      <AlertDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Usunąć kategorię?</AlertDialogTitle>
            <AlertDialogDescription>
              Kategoria „{toDelete?.name}” zostanie trwale usunięta. Tej
              operacji nie można cofnąć.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Anuluj</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={pending}>
              {pending ? "Usuwanie…" : "Usuń"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsCard>
  );
}
