import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "adgen_session";

// Proxy (dawne middleware) sprawdza tylko obecność ciasteczka sesji (brak dostępu do bazy).
// Właściwa walidacja sesji i ról odbywa się serwerowo: requireUser()/requireAdmin()
// w layoutach, akcjach serwerowych i route handlerach.
//
// AUTH_DISABLED=1 (sieć zamknięta, np. Tailscale): pomijamy wymóg sesji,
// a /login przekierowuje od razu do aplikacji.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const authDisabled = process.env.AUTH_DISABLED === "1";

  if (authDisabled) {
    if (pathname === "/login") {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  const isPublic = pathname === "/login";
  const hasSession = request.cookies.has(SESSION_COOKIE);

  if (!isPublic && !hasSession) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }
  if (isPublic && hasSession) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // wszystko poza zasobami statycznymi ORAZ trasami cron (te bronią się
    // własnym nagłówkiem x-cron-secret — proxy nie może ich przekierować na
    // /login, bo są wołane bezsesyjnie z crontab/systemd)
    "/((?!_next/static|_next/image|favicon.ico|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
