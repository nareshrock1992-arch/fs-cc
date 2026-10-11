// Caller-name normalization (pure, dependency-free).
//
// Returns a usable caller display name, or null when the raw value is not a
// trustworthy name. Rules (see caller-name audit):
//   - empty / whitespace-only            → null
//   - a known generic placeholder        → null  (Unknown, Anonymous, …)
//   - identical to the caller number     → null  (FreeSWITCH often sets
//                                                  caller-id-name = number)
// A valid name is trimmed and capped at the calls.cid_name column width (128).
// This never invents a name and never considers the destination/agent identity.

const GENERIC = new Set([
  'unknown', 'anonymous', 'n/a', 'na', 'null', 'none',
  'unavailable', 'restricted', 'private', 'withheld', 'no name',
]);

export function cleanCallerName(rawName, number = null) {
  if (rawName == null) return null;
  const name = String(rawName).trim();
  if (name === '') return null;
  if (GENERIC.has(name.toLowerCase())) return null;
  if (number != null && name === String(number).trim()) return null; // name == number
  return name.slice(0, 128);
}
