// The first access read may wait for a lazy desktop claim. Keep the caller's
// deadline longer than the server's bounded claim window, including transport.
export const COMPUTER_CLAIM_GRACE_MS = 5_000;
export const COMPUTER_ACCESS_TIMEOUT_MS = COMPUTER_CLAIM_GRACE_MS + 3_000;
