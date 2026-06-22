import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();

  const validUser = process.env.ADMIN_USERNAME;
  const validPass = process.env.ADMIN_PASSWORD;
  const secret = process.env.AUTH_SECRET!;

  if (username !== validUser || password !== validPass) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  // Simple signed token: base64(username:timestamp):signature
  const payload = Buffer.from(`${username}:${Date.now()}`).toString('base64');
  const signature = Buffer.from(`${payload}:${secret}`).toString('base64');
  const token = `${payload}.${signature}`;

  const response = NextResponse.json({ success: true });
  response.cookies.set('yt_auth', token, {
    httpOnly: true,
    secure: false,      // HTTP pe bhi kaam kare
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  });

  return response;
}