// Wspólny typ wyniku akcji serwerowych — formularze pokazują error toastem
// lub przy polu; sukces zamyka dialog i odświeża dane (revalidatePath w akcji).

export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

export function ok(message?: string): ActionResult {
  return { ok: true, message };
}

export function fail(error: string): ActionResult {
  return { ok: false, error };
}
