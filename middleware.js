export default function middleware(req) {
  const url = new URL(req.url);

  // Protect /configurateur — only allow if kb_auth cookie is set
  if (url.pathname === '/configurateur') {
    const cookie = req.headers.get('cookie') || '';
    const hasAuth = cookie.split(';').some(c => c.trim() === 'kb_auth=ok');
    if (!hasAuth) {
      return Response.redirect(new URL('/configurateurs', req.url));
    }
  }

  return new Response(null, { status: 200, headers: { 'x-middleware-next': '1' } });
}

export const config = {
  matcher: ['/configurateur'],
};
