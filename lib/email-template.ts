// Szablon HTML maili przypominających — w brandzie adGen (akcent pomarańczowy).
// Style inline + układ tabelkowy = maksymalna zgodność z klientami poczty
// (Gmail, Outlook). Bez web-fontów; fallback Arial/Helvetica.

const ACCENT = "#EA580C";
const INK = "#1c1917";
const MUTED = "#78716c";
const LINE = "#e8e5df";

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
        `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:${INK}">${escapeHtml(
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
}): string {
  const attachmentBox = opts.hasAttachment
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 4px">
         <tr><td style="background:#fdeadd;border:1px solid #f4c9ab;border-radius:10px;padding:12px 16px;font-size:14px;color:#9a3412;line-height:1.5">
           <strong>W załączniku znajdziesz fakturę</strong> do opłacenia. Prosimy o uregulowanie należności w terminie.
         </td></tr>
       </table>`
    : "";

  const footer = opts.footerText
    ? `<tr><td style="padding:18px 32px 28px">
         <div style="border-top:1px solid ${LINE};padding-top:16px;font-size:12.5px;line-height:1.6;color:${MUTED};white-space:pre-line">${escapeHtml(
           opts.footerText
         )}</div>
       </td></tr>`
    : "";

  return `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(opts.subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ${LINE}">
        <!-- Nagłówek -->
        <tr><td style="background:${ACCENT};padding:20px 32px">
          <span style="font-size:22px;font-weight:800;letter-spacing:-0.5px;color:#ffffff">adGen</span>
          <span style="display:block;margin-top:2px;font-size:12px;letter-spacing:0.4px;color:#ffe4d3;text-transform:uppercase">Przypomnienie o płatności</span>
        </td></tr>
        <!-- Treść -->
        <tr><td style="padding:28px 32px 8px">
          ${paragraphs(opts.bodyText)}
          ${attachmentBox}
        </td></tr>
        ${footer}
      </table>
      <div style="max-width:600px;margin:14px auto 0;font-size:11px;color:#a8a29e;text-align:center">
        Wiadomość wysłana automatycznie z systemu adGen.
      </div>
    </td></tr>
  </table>
</body></html>`;
}
