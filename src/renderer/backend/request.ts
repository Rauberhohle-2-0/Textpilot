/**
 * The fetch plumbing every renderer API call goes through.
 *
 * One place decides what a failed request means and what the error says,
 * so no caller has to remember to check `response.ok` or to build a
 * `content-type` header by hand.
 */

/** A JSON request body: serialized, with the content type set. */
export function jsonBody(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
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
  const response = await fetch(url, init);
  if (!response.ok && !extraOk.includes(response.status)) {
    throw new Error(`${action} failed: ${response.status}`);
  }
  return response;
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
