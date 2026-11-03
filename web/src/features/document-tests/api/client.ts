/** Shared JSON transport for document-test feature endpoints. */
export class HttpRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'HttpRequestError'; }
}

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try { message = (await response.json()).error ?? message; } catch { /* the response may have no JSON body */ }
    throw new HttpRequestError(response.status, String(message));
  }
  return response.json() as Promise<T>;
}
