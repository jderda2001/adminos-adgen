// Opcje kategorii pogrupowane sekcjami arkusza (do dropdownów w imporcie i
// edycji partii). Współdzielone przez rw-import-dialog i rw-batch-edit-dialog.

import {
  RW_CATEGORIES,
  RW_BUCKET_LABELS,
  type RwBucket,
  type RwKind,
} from "@/lib/rw-types";

export function categoryGroups(kind: RwKind) {
  // tylko kategorie AKTYWNE — zdeprecjonowane (stara taksonomia) są ukryte
  // w dropdownie, choć nadal ważne dla danych historycznych
  const cats = RW_CATEGORIES.filter((c) => c.kind === kind && !c.deprecated);
  const buckets = [...new Set(cats.map((c) => c.bucket))] as RwBucket[];
  return buckets.map((b) => ({
    label: RW_BUCKET_LABELS[b],
    items: cats.filter((c) => c.bucket === b).map((c) => c.name),
  }));
}
