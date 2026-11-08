/**
 * Redacting logger. SIP.js log output can contain Authorization headers (digest responses)
 * and SDP. We never log passwords; digest headers are masked.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const REDACTIONS: Array<[RegExp, string]> = [
  [/^((?:Proxy-)?Authorization:).*$/gim, '$1 ***REDACTED***'],
  [/\b(response|cnonce|nonce)="[^"]*"/gi, '$1="***"'],
  [/("?password"?\s*[:=]\s*)"[^"]*"/gi, '$1"***"'],
];

export function redact(text: string): string {
  return REDACTIONS.reduce(
    (acc, [pattern, replacement]) => acc.replace(pattern, replacement),
    text,
  );
}

let minimumLevel: LogLevel = import.meta.env?.DEV ? 'debug' : 'warn';

export function setLogLevel(level: LogLevel): void {
  minimumLevel = level;
}

export function log(level: LogLevel, category: string, message: string): void {
  if (ORDER[level] < ORDER[minimumLevel]) return;
  const line = `[${category}] ${redact(message)}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}
