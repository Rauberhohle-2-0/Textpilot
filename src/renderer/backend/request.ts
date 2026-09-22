/**
 * The fetch plumbing every renderer API call goes through.
 *
 * One place decides what a failed request means and what the error says,
 * so no caller has to remember to check `response.ok` or to build a
 * `content-type` header by hand.
 *
 * When the host page carries `<meta name="textpilot-api-token"
 * content="...">` (packaging that sets `TEXTPILOT_TOKEN` injects it),
 * the token is attached as `Authorization: Bearer`. Absent meta means
 * no header - the server's token guard is opt-in and stays off.
 */

/** A JSON request body: serialized, with the content type set. */
export function jsonBody(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { ...authHeader(), "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** The bearer header when the host page provides a token, else nothing. */
function authHeader(): Record<string, string> {
  const token = document
    .querySelector('meta[name="textpilot-api-token"]')
    ?.getAttribute("content")
    ?.trim();
  return token ? { authorization: `Bearer ${token}` } : {};
}

/**
 * Run a request, failing on any status that is not ok. `extraOk` covers
 * the idempotent deletes, where a 404 means "already gone", not an error.
 */
async function send(
  url: string,
  action: string,
  init?: RequestInit,
  extraOk: readonly number[] = [],
): Promise<Response> {
  const response = await fetch(url, withAuth(init));
  if (!response.ok && !extraOk.includes(response.status)) {
    throw new Error(`${action} failed: ${response.status}`);
  }
  return response;
}

/** Merge the bearer header into any request without clobbering callers. */
function withAuth(init?: RequestInit): RequestInit | undefined {
  const extra = authHeader();
  if (Object.keys(extra).length === 0) return init;
  return {
    ...init,
    headers: { ...extra, ...(init?.headers as Record<string, string> | undefined) },
  };
}

/** A request whose JSON body is the result. */
export async function fetchJson<T>(
  url: string,
  action: string,
  init?: RequestInit,
): Promise<T> {
  return (await send(url, action, init).then((response) => response.json())) as T;
}

/** A request kept only for its status. */
export async function fetchVoid(
  url: string,
  action: string,
  init?: RequestInit,
  extraOk: readonly number[] = [],
): Promise<void> {
  await send(url, action, init, extraOk);
}
