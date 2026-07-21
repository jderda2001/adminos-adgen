// Szablon HTML maili przypominających — minimalistyczny styl „Apple":
// biała karta na jasnoszarym tle, logo adGen na górze (osadzone inline przez CID),
// dużo światła, monochromatyczna typografia. Style inline + układ tabelkowy =
// maksymalna zgodność z klientami poczty (Gmail, Outlook, Apple Mail).

const INK = "#1d1d1f";
const MUTED = "#6e6e73";
const LINE = "#e8e8ed";
const PAGE = "#f5f5f7";
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Arial,sans-serif";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Tekst → akapity HTML (podwójny enter = nowy akapit, pojedynczy = <br>). */
function paragraphs(text: string): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 15px;font-size:16px;line-height:1.6;color:${INK}">${escapeHtml(
          p
        ).replace(/\n/g, "<br>")}</p>`
    )
    .join("");
}

export function renderReminderEmailHtml(opts: {
  subject: string;
  bodyText: string;
  footerText?: string;
  hasAttachment?: boolean;
  amountText?: string; // kwota brutto do zapłaty
  dueText?: string; // termin płatności
  logoCid?: string; // Content-ID osadzonego logo (inline)
}): string {
  const header = opts.logoCid
    ? `<img src="cid:${opts.logoCid}" alt="adGen" width="120" style="display:block;width:120px;max-width:55%;height:auto;margin:0 auto" />`
    : `<div style="font-size:24px;font-weight:700;letter-spacing:-0.5px;color:${INK};text-align:center">adGen</div>`;

  const summaryBox =
    opts.amountText || opts.dueText
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 20px">
           <tr><td style="background:${PAGE};border-radius:14px;padding:18px 20px">
             <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
               <td style="vertical-align:top">
                 <div style="font-size:11px;letter-spacing:0.6px;text-transform:uppercase;color:${MUTED};margin-bottom:5px">Do zapłaty</div>
                 <div style="font-size:26px;font-weight:700;letter-spacing:-0.5px;color:${INK};line-height:1.1">${escapeHtml(opts.amountText ?? "—")}</div>
               </td>
               <td style="vertical-align:top;text-align:right">
                 <div style="font-size:11px;letter-spacing:0.6px;text-transform:uppercase;color:${MUTED};margin-bottom:5px">Termin płatności</div>
                 <div style="font-size:16px;font-weight:600;color:${INK};line-height:1.3">${escapeHtml(opts.dueText ?? "—")}</div>
               </td>
             </tr></table>
           </td></tr>
         </table>`
      : "";

  const attachmentBox = opts.hasAttachment
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:2px 0 4px">
         <tr><td style="border:1px solid ${LINE};border-radius:12px;padding:14px 18px;font-size:14px;color:${INK};line-height:1.5">
           <strong style="font-weight:600">W załączniku znajdziesz fakturę</strong> do opłacenia. Prosimy o uregulowanie należności w terminie.
         </td></tr>
       </table>`
    : "";

  const footer = opts.footerText
    ? `<tr><td style="padding:8px 40px 32px">
         <div style="border-top:1px solid ${LINE};padding-top:18px;font-size:12.5px;line-height:1.6;color:${MUTED};white-space:pre-line">${escapeHtml(
           opts.footerText
         )}</div>
       </td></tr>`
    : "";

  return `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(opts.subject)}</title></head>
<body style="margin:0;padding:0;background:${PAGE};font-family:${FONT};-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE};padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:100%;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid ${LINE}">
        <!-- Logo -->
        <tr><td align="center" style="padding:40px 40px 0">${header}</td></tr>
        <tr><td style="padding:26px 40px 0"><div style="height:1px;background:${LINE};line-height:1px;font-size:0">&nbsp;</div></td></tr>
        <!-- Treść -->
        <tr><td style="padding:28px 40px ${opts.footerText ? "4px" : "36px"}">
          ${paragraphs(opts.bodyText)}
          ${summaryBox}
          ${attachmentBox}
        </td></tr>
        ${footer}
      </table>
      <div style="max-width:560px;margin:16px auto 0;font-size:11px;color:#a1a1a6;text-align:center">
        Wiadomość wysłana automatycznie z systemu adGen.
      </div>
    </td></tr>
  </table>
</body></html>`;
}
