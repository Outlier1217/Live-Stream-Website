import { NextRequest, NextResponse } from 'next/server';

function verifyToken(token: string): boolean {
  const secret = process.env.AUTH_SECRET!;
  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const [payload, signature] = parts;
  const expectedSig = Buffer.from(`${payload}:${secret}`).toString('base64');
  return signature === expectedSig;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // In paths ko skip karo
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/auth/login') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon.ico')
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get('yt_auth')?.value;

  if (!token || !verifyToken(token)) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};