import { NextResponse } from 'next/server';

// First line of route protection: no session cookie → sign-in page.
// The API verifies the session on every request, so an expired or forged cookie
// still cannot read data; the client then redirects to /login on the 401.
export function middleware(req) {
  const { pathname, search } = req.nextUrl;
  const hasSession = req.cookies.has('sw_session');

  if (pathname === '/login') return NextResponse.next();
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|icon.svg|favicon.ico).*)'],
};
