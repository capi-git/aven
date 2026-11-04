import { describe, expect, it } from "vitest";
import { scrubSecrets } from "./scrubSecrets";

// Made-up values, built so nothing here looks like a real credential on disk.
const TOKEN = ["abc", "DEF", "123", "xyz", "789"].join("");

describe("scrubSecrets", () => {
  it("removes the values someone just typed, plain or URL-encoded", () => {
    expect(scrubSecrets(`failed with hunter two!`, ["hunter two!"])).toBe(
      "failed with [hidden]",
    );
    expect(
      scrubSecrets(`GET /x?k=${encodeURIComponent("a b&c")}`, ["a b&c"]),
    ).toBe("GET /x?k=[hidden]");
    // A longer value is removed whole, not around a shorter one inside it.
    expect(scrubSecrets("abcdefgh", ["abcd", "abcdefgh"])).toBe("[hidden]");
    // Very short values would hit ordinary words.
    expect(scrubSecrets("set on", ["on"])).toBe("set on");
  });

  it("removes bearer tokens and keeps the sentence", () => {
    expect(scrubSecrets(`rejected Bearer ${TOKEN} from server`)).toBe(
      "rejected Bearer [hidden] from server",
    );
    expect(scrubSecrets(`Authorization: Bearer ${TOKEN}`)).toBe(
      "Authorization: Bearer [hidden]",
    );
  });

  it("removes key=value secrets in the forms CLIs print", () => {
    expect(scrubSecrets(`API_KEY=${TOKEN} node`)).toBe("API_KEY=[hidden] node");
    expect(scrubSecrets(`GITHUB_TOKEN: ${TOKEN}`)).toBe(
      "GITHUB_TOKEN: [hidden]",
    );
    expect(scrubSecrets(`{"client_secret":"${TOKEN}","x":1}`)).toBe(
      `{"client_secret":[hidden],"x":1}`,
    );
    expect(scrubSecrets(`https://x.dev/m?access_token=${TOKEN}&a=1`)).toBe(
      "https://x.dev/m?access_token=[hidden]&a=1",
    );
    expect(scrubSecrets(`run --api-key ${TOKEN} --verbose`)).toBe(
      "run --api-key [hidden] --verbose",
    );
    expect(scrubSecrets(`run --password=${TOKEN}`)).toBe(
      "run --password=[hidden]",
    );
    expect(scrubSecrets(`https://me:${TOKEN}@x.dev/m`)).toBe(
      "https://me:[hidden]@x.dev/m",
    );
  });

  it("removes tokens recognisable by their format alone", () => {
    expect(scrubSecrets(`saw ${"ghp_"}${TOKEN}${TOKEN} there`)).toBe(
      "saw [hidden] there",
    );
    expect(scrubSecrets(`saw ${"sk-"}${TOKEN}${TOKEN}`)).toBe("saw [hidden]");
  });

  it("leaves messages that only talk about credentials readable", () => {
    for (const message of [
      "Authorization header is badly formatted",
      "bearer token has expired",
      "invalid_token: the access token expired",
      "HTTP 401 Unauthorized",
      "ENOENT: no such file or directory, posix_spawn '/x/ScapeMCPServer'",
      "No URL configured for this server",
    ])
      expect(scrubSecrets(message)).toBe(message);
  });
});
