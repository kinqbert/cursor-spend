export class SpendError extends Error {
  constructor(status, body) {
    super(messageFor(status, body));
    this.name = "SpendError";
    this.status = status;
    this.body = body;
  }
}

function messageFor(status, body) {
  const detail =
    typeof body === "object" && body !== null
      ? body.message || body.error || JSON.stringify(body)
      : String(body);
  if (status === 401 || status === 204) {
    return `Not signed in to Cursor (${status} ${detail}). Open the Cursor app and sign in, then retry.`;
  }
  return `${status} ${detail}`;
}
