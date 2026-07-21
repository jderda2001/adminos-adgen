import { describe, expect, it } from "vitest";
import {
  buildReminderTimeline,
  currentStepFor,
  renderReminderMessage,
  type ExistingReminder,
} from "../lib/payment-reminders";

const due = new Date(Date.UTC(2026, 6, 10)); // 2026-07-10
const day = (d: number) => new Date(Date.UTC(2026, 6, d));
const noExisting: ExistingReminder[] = [];
const chan = (step: ReturnType<typeof buildReminderTimeline>["steps"][number], c: string) =>
  step.channels.find((x) => x.channel === c)!;
const stepOf = (tl: ReturnType<typeof buildReminderTimeline>, key: string) =>
  tl.steps.find((s) => s.key === key)!;

describe("currentStepFor", () => {
  it("dobiera największy offset ≤ dni od terminu", () => {
    expect(currentStepFor(-3)).toBeNull(); // przed D-1
    expect(currentStepFor(-1)?.key).toBe("D-1");
    expect(currentStepFor(0)?.key).toBe("D0");
    expect(currentStepFor(1)?.key).toBe("D+1");
    expect(currentStepFor(2)?.key).toBe("D+2");
    expect(currentStepFor(3)?.key).toBe("D+3");
    expect(currentStepFor(10)?.key).toBe("D+3"); // po ostatnim kroku — trzymamy D+3
  });
});

describe("buildReminderTimeline", () => {
  it("przed D-1: nic nie jest aktualne ani do wysłania", () => {
    const tl = buildReminderTimeline(due, day(7), noExisting, { paid: false, enabled: true });
    expect(tl.currentStepKey).toBeNull();
    expect(tl.steps.every((s) => s.channels.every((c) => c.status === "PENDING"))).toBe(true);
    expect(tl.steps.every((s) => s.channels.every((c) => !c.actionable))).toBe(true);
  });

  it("dzień przed terminem: D-1 do wysłania (SMS+e-mail), reszta czeka", () => {
    const tl = buildReminderTimeline(due, day(9), noExisting, { paid: false, enabled: true });
    expect(tl.currentStepKey).toBe("D-1");
    const dm1 = stepOf(tl, "D-1");
    expect(chan(dm1, "SMS").status).toBe("QUEUED");
    expect(chan(dm1, "SMS").actionable).toBe(true);
    expect(chan(dm1, "EMAIL").actionable).toBe(true);
    expect(chan(stepOf(tl, "D0"), "SMS").status).toBe("PENDING");
  });

  it("tylko najswiezszy: 3 dni po terminie -> D+3 aktualny, wczesniejsze pominiete", () => {
    const tl = buildReminderTimeline(due, day(13), noExisting, { paid: false, enabled: true });
    expect(tl.currentStepKey).toBe("D+3");
    for (const k of ["D-1", "D0", "D+1", "D+2"]) {
      expect(stepOf(tl, k).channels.every((c) => c.status === "SKIPPED")).toBe(true);
      expect(stepOf(tl, k).channels.every((c) => !c.actionable)).toBe(true);
    }
    expect(chan(stepOf(tl, "D+3"), "SMS").actionable).toBe(true);
    expect(chan(stepOf(tl, "D+3"), "PHONE").actionable).toBe(true);
  });

  it("opłacona faktura zatrzymuje sekwencję — nic nie jest do wysłania", () => {
    const tl = buildReminderTimeline(due, day(13), noExisting, { paid: true, enabled: true });
    expect(tl.stopped).toBe(true);
    expect(tl.currentStepKey).toBeNull();
    expect(tl.steps.every((s) => s.channels.every((c) => !c.actionable))).toBe(true);
    // kroki, których dzień minął, a nie wysłano → pominięte
    expect(stepOf(tl, "D0").channels.every((c) => c.status === "SKIPPED")).toBe(true);
  });

  it("pauza (enabled=false) też zatrzymuje", () => {
    const tl = buildReminderTimeline(due, day(9), noExisting, { paid: false, enabled: false });
    expect(tl.stopped).toBe(true);
    expect(tl.currentStepKey).toBeNull();
  });

  it("istniejacy wpis SENT jest pokazany i nie jest juz do wyslania; QUEUED na aktualnym -> do wyslania", () => {
    const existing: ExistingReminder[] = [
      { stepKey: "D-1", channel: "SMS", status: "SENT", sentAt: "2026-07-09T08:00:00.000Z", actedByName: "Jan" },
      { stepKey: "D0", channel: "EMAIL", status: "QUEUED" },
    ];
    const tl = buildReminderTimeline(due, day(10), existing, { paid: false, enabled: true });
    const sms = chan(stepOf(tl, "D-1"), "SMS");
    expect(sms.status).toBe("SENT");
    expect(sms.actionable).toBe(false);
    expect(sms.actedByName).toBe("Jan");
    // D0 to aktualny krok → zakolejkowany e-mail jest do wysłania
    expect(chan(stepOf(tl, "D0"), "EMAIL").actionable).toBe(true);
  });
});

describe("renderReminderMessage", () => {
  const ctx = { amountGr: 615000, dueDate: new Date(Date.UTC(2026, 6, 10)) }; // 6150 zł, 10.07.2026

  it("każdy SMS niesie kwotę brutto i termin", () => {
    for (const key of ["D-1", "D0", "D+1", "D+3"]) {
      const sms = renderReminderMessage(key, "SMS", { ctx });
      expect(sms.subject).toBeNull();
      expect(sms.body).toContain("6150,00 zł"); // kwota brutto
      expect(sms.body).toContain("10.07.2026"); // termin
      expect(sms.body).not.toContain("{"); // brak niepodstawionych placeholderów
    }
  });

  it("e-mail = temat + treść z kwotą/terminem + stopka; telefon = instrukcja z kwotą", () => {
    const email = renderReminderMessage("D-1", "EMAIL", { emailFooter: "Zespół adGen", ctx });
    expect(email.subject).toContain("10.07.2026");
    expect(email.body).toContain("6150,00 zł");
    expect(email.body).toContain("Zespół adGen"); // stopka doklejona

    const phone = renderReminderMessage("D+2", "PHONE", { ctx });
    expect(phone.body).toContain("Kwota do zapłaty: 6150,00 zł");
    expect(phone.body).toContain("Telefon z działu administracyjnego");
  });

  it("bez ctx placeholdery zastępowane myślnikiem (nie zostają {kwota})", () => {
    const sms = renderReminderMessage("D-1", "SMS");
    expect(sms.body).not.toContain("{");
  });
});
