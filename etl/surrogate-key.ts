/**
 * Stable surrogate keys for the warehouse.
 *
 * Lives in its own module because build-warehouse.ts calls main() at module
 * scope, so importing anything from it runs a full warehouse build. That made
 * `npm run images` exit 1 on every run: the import triggered a build, the
 * build threw on a gitignored input file, and the exit code reported a failure
 * the image step never had.
 */

/** FNV-1a 64-bit. Stable across machines and runs, unlike an autoincrement. */
export function surrogateKey(...parts: Array<string | number>): bigint {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const byte of Buffer.from(parts.join('|'), 'utf8')) {
    h = ((h ^ BigInt(byte)) * prime) & mask;
  }
  // Keep it inside signed BIGINT so every destination can store it.
  return h >> 1n;
}
