const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function newId(prefix: 'brd' | 'lst' | 'crd'): string {
  let suffix = '';
  for (let i = 0; i < 6; i += 1) {
    suffix += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return `${prefix}_${suffix}`;
}
