const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

export function json(data: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  const headers = new Headers(JSON_HEADERS);
  for (const [key, value] of Object.entries(extraHeaders ?? {})) headers.set(key, value);
  return new Response(JSON.stringify(data), {
    status,
    headers,
  });
}

export function notFound(message = 'not_found'): Response {
  return json({ error: message }, 404);
}

export function badRequest(message = 'bad_request'): Response {
  return json({ error: message }, 400);
}

export function unauthorized(message = 'unauthorized'): Response {
  return json({ error: message }, 401);
}

export function forbidden(message = 'forbidden'): Response {
  return json({ error: message }, 403);
}

export function serverError(message = 'server_error'): Response {
  return json({ error: message }, 500);
}
