/**
 * Takes secret values out of text a provider produced, before Aven shows or
 * logs it: values the person just typed, bearer tokens, and key=value secrets.
 * It errs towards hiding, but keeps the words that say what went wrong.
 */
const HIDDEN = "[hidden]";

/** Shorter values match ordinary words, and hiding those garbles the message. */
const MIN_KNOWN_LENGTH = 4;

const SECRET_NAME = String.raw`[\w.-]*(?:token|secret|password|passwd|pwd|api[_-]?key|access[_-]?key|private[_-]?key|credential|authorization|cookie)[\w.-]*`;

/** `key=value`, `key: value` and `"key": "value"`, with any auth scheme kept. */
const KEY_VALUE = new RegExp(
  String.raw`(${SECRET_NAME})(["']?\s*[:=]\s*)((?:bearer|basic|token)\s+)?(?:"[^"]*"|'[^']*'|[^\s"',;&)]+)`,
  "gi",
);
/** `--token value`; `--token=value` is a key=value. */
const FLAG_VALUE = new RegExp(
  String.raw`(--${SECRET_NAME}\s+)(?!-)[^\s"',;&)]+`,
  "gi",
);
const AUTH_SCHEME = /\b(bearer|basic)(\s+)([A-Za-z0-9\-._~+/]+=*)/gi;
const URL_PASSWORD = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]*:)[^\s/@]+(@)/gi;
const KNOWN_FORMATS =
  /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_\w{16,}|sk-[\w-]{16,}|xox[a-z]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*)/g;
/** OAuth's own error names ("invalid_token: …") describe, they don't hold. */
const DESCRIBES_A_FAILURE = /^(?:invalid|missing|expired|bad|no)[_-]/i;

/** "bearer token" is a phrase; "Bearer abc123…" is a credential. */
function looksLikeAToken(value: string): boolean {
  return value.length >= 8 && /[^a-z]/.test(value);
}

export function scrubSecrets(
  text: string,
  known: readonly string[] = [],
): string {
  let out = text;
  // Longest first, so a value inside a longer one can't leave part of it.
  const values = known
    .filter((value) => value.length >= MIN_KNOWN_LENGTH)
    .flatMap((value) => [value, encodeURIComponent(value)])
    .sort((a, b) => b.length - a.length);
  for (const value of values) out = out.split(value).join(HIDDEN);
  return out
    .replace(KEY_VALUE, (match, name: string, joint: string, scheme = "") =>
      DESCRIBES_A_FAILURE.test(name)
        ? match
        : `${name}${joint}${scheme}${HIDDEN}`,
    )
    .replace(FLAG_VALUE, `$1${HIDDEN}`)
    .replace(
      AUTH_SCHEME,
      (match, scheme: string, gap: string, value: string) =>
        looksLikeAToken(value) ? `${scheme}${gap}${HIDDEN}` : match,
    )
    .replace(URL_PASSWORD, `$1${HIDDEN}$2`)
    .replace(KNOWN_FORMATS, HIDDEN);
}
