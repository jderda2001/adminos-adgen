"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  changeOwnPasswordAction,
  type ChangePasswordState,
} from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Wymuszona zmiana hasła po pierwszym logowaniu (konto z hasłem tymczasowym)
export function ForcePasswordChange() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<
    ChangePasswordState,
    FormData
  >(changeOwnPasswordAction, {});

  useEffect(() => {
    if (state.success) router.refresh();
  }, [state.success, router]);

  return (
    <div className="flex justify-center pt-10">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Ustaw nowe hasło</CardTitle>
          <CardDescription>
            Logujesz się hasłem tymczasowym — ustaw własne, aby kontynuować.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">Obecne hasło (tymczasowe)</Label>
              <Input
                id="currentPassword"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Nowe hasło</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Powtórz hasło</Label>
              <Input
                id="confirm"
                name="confirm"
                type="password"
                autoComplete="new-password"
                required
              />
            </div>
            {state.error && (
              <p className="text-sm text-destructive" role="alert">
                {state.error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Zapisywanie…" : "Zapisz hasło"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
