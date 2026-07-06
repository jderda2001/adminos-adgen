import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "adgen_session";

// Proxy (dawne middleware) sprawdza tylko obecność ciasteczka sesji (brak dostępu do bazy).
// Właściwa walidacja sesji i ról odbywa się serwerowo: requireUser()/requireAdmin()
// w layoutach, akcjach serwerowych i route handlerach.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

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
    // wszystko poza zasobami statycznymi
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
