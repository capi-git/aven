/**
 * What keeps the memory keeper safe to run. Project memory reaches every agent
 * in the project, so nothing the keeper reads may steer those agents, and no
 * secret may end up in it. Repository text, git history and past chats are
 * treated as untrusted data on the way in, and the model's reply is checked
 * again on the way out.
 */

/** Files the keeper never reads or lists: environment files, keys, credentials. */
const SECRET_FILE_PATTERNS: readonly RegExp[] = [
  /^\.env(?:\..*)?$/i,
  /\.(?:pem|key|p8|p12|pfx|jks|keystore|crt|cer|der|asc|gpg|kdbx)$/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i,
  /^\.(?:npmrc|pypirc|netrc|git-credentials|htpasswd|pgpass|dockercfg)$/i,
  /(?:secret|credential|password|passwd|token|apikey|api[-_]key)/i,
  /^service[-_]?account.*\.json$/i,
];

export function isSecretFileName(name: string): boolean {
  return SECRET_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

export const REDACTED = "[redacted]";

const SECRET_PATTERNS: readonly [RegExp, string][] = [
  [
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
    REDACTED,
  ],
  // Provider keys with recognisable prefixes.
  [/\bsk-(?:ant-|proj-|live-)?[A-Za-z0-9_-]{16,}/g, REDACTED],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, REDACTED],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, REDACTED],
  [/\bglpat-[A-Za-z0-9_-]{16,}/g, REDACTED],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, REDACTED],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, REDACTED],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, REDACTED],
  [/\b[sprw]k_(?:live|test)_[A-Za-z0-9]{10,}/g, REDACTED],
  [/\bnpm_[A-Za-z0-9]{30,}/g, REDACTED],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]{16,}=*/gi, `$1 ${REDACTED}`],
  // Credentials inside a URL: scheme://user:password@host
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, `$1${REDACTED}@`],
  // Assignments to something that names a secret: TOKEN=…, "apiKey": "…"
  [
    /\b([A-Za-z0-9_.-]*(?:secret|token|password|passwd|pwd|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|credentials?)[A-Za-z0-9_.-]*["']?\s*[:=]\s*)(["']?)([^\s"'`,;]{6,})\2/gi,
    `$1$2${REDACTED}$2`,
  ],
];

/** Replace anything that looks like a secret with `[redacted]`. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS)
    out = out.replace(pattern, replacement);
  return out;
}

const AI_WORDS =
  "(?:ai|a\\.i\\.|llms?|language models?|assistants?|chat ?gpt|gpt(?:-\\d[\\w.]*)?|claude|codex|copilot|gemini|chatbots?)";

/**
 * Lines that try to steer a model rather than describe a project: prompt
 * injection phrases, text addressed to an AI, chat role markers. Ordinary
 * project rules ("Use pnpm") are kept.
 */
const INSTRUCTION_PATTERNS: readonly RegExp[] = [
  /\b(?:ignore|disregard|forget|override|bypass)\b[^\n]{0,60}\b(?:previous|prior|above|earlier|preceding|all|any|other|your|system)\b[^\n]{0,40}\b(?:instructions?|prompts?|rules|messages?|context|directions|guidelines)\b/i,
  /\b(?:system prompt|developer (?:message|instructions)|jailbreak|prompt injection|do anything now)\b/i,
  new RegExp(
    `\\b(?:you are|you're|act as|pretend to be|behave as)\\s+(?:now\\s+)?(?:an?\\s+|the\\s+)?${AI_WORDS}\\b`,
    "i",
  ),
  new RegExp(`\\b(?:if|when|as)\\s+you\\s+are\\s+an?\\s+${AI_WORDS}\\b`, "i"),
  new RegExp(
    `^\\W*(?:note|message|instructions?|attention|reminder|hint|prompt)s?\\s+(?:to|for)\\s+(?:the\\s+|any\\s+|all\\s+)?${AI_WORDS}\\b`,
    "i",
  ),
  new RegExp(
    `^\\W*(?:dear|hey|hi|hello)?\\s*${AI_WORDS}(?:\\s+agents?)?\\s*[:,]`,
    "i",
  ),
  new RegExp(
    `\\b${AI_WORDS}(?:\\s+(?:agents?|models?|tools?))?\\s+(?:must|should|shall|need to|needs to|are (?:required|instructed|told) to|have to|has to)\\b`,
    "i",
  ),
  /<\|?\s*(?:im_start|im_end|endoftext|system|assistant)\s*\|?>/i,
  /\[\/?\s*(?:INST|SYS)\s*\]/i,
  /<\/?\s*(?:system|instructions?|assistant|user|human|tool_call|function_call)\s*>/i,
  /^\s{0,3}#{1,6}\s*(?:system|assistant|instructions? for (?:the )?(?:ai|model|agent))\b/i,
  /^\s*(?:system|assistant|human|user)\s*:/i,
  /<!--.*\b(?:aven|ai|llm|assistant|agents?|model|instructions?|prompt)\b.*-->/i,
  /\baven[-:](?:auto|project-memory)\b|<\/?\s*aven-/i,
];

export function looksLikeAgentInstruction(line: string): boolean {
  return INSTRUCTION_PATTERNS.some((pattern) => pattern.test(line));
}

/**
 * Drop lines addressed to a model. Returns the kept text and how many lines
 * were removed, so a caller can note it.
 */
export function stripAgentInstructions(text: string): {
  text: string;
  removed: number;
} {
  let removed = 0;
  const kept = text.split("\n").filter((line) => {
    if (!looksLikeAgentInstruction(line)) return true;
    removed += 1;
    return false;
  });
  return { text: kept.join("\n"), removed };
}

/** Redact secrets, drop instructions to models, and cap the length. */
export function cleanUntrusted(text: string, maxChars: number): string {
  const normalized = text
    .replace(/\r\n?/g, "\n")
    // Control characters other than tab and newline have no place in a digest.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f‪-‮⁦-⁩]/g, "");
  const { text: stripped } = stripAgentInstructions(redactSecrets(normalized));
  return clip(stripped.replace(/\n{3,}/g, "\n\n").trim(), maxChars);
}

/** At most `maxChars`, cut at a line or word boundary, marked when cut. */
export function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, Math.max(0, maxChars - 1));
  const line = cut.lastIndexOf("\n");
  const at = line > maxChars * 0.6 ? line : cut.lastIndexOf(" ");
  return `${(at > maxChars * 0.4 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

/**
 * Wrap untrusted material in a tag the instructions refer to. A copy of the
 * tag inside the material is defused, so it cannot close the block early.
 */
export function wrapData(tag: string, text: string): string {
  const defused = text.replace(
    new RegExp(
      `<(\\/?)\\s*(${tag}|project-digest|recent-work|current-memory|user-notes|removed-lines|git-history)\\b`,
      "gi",
    ),
    "‹$1$2",
  );
  return `<${tag}>\n${defused.trim()}\n</${tag}>`;
}
