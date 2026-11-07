const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Returns a random 16-character ID of digits and lowercase letters, for a board, an item, an image, a batch, or a connection. The browser and the Worker both make IDs. */
export function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let id = "";
  for (const byte of bytes) id += ALPHABET.charAt(byte % ALPHABET.length);
  return id;
}
