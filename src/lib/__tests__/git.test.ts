import { parseGitRemote, parsePrUrl } from "../git";

describe("parseGitRemote", () => {
  it("parses SSH URL with .git", () => {
    const result = parseGitRemote("git@github.com:owner/repo.git");
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });

  it("parses SSH URL without .git", () => {
    const result = parseGitRemote("git@github.com:owner/repo");
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });

  it("parses HTTPS URL with .git", () => {
    const result = parseGitRemote("https://github.com/owner/repo.git");
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });

  it("parses HTTPS URL without .git", () => {
    const result = parseGitRemote("https://github.com/owner/repo");
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });

  it("parses HTTP URL", () => {
    const result = parseGitRemote("http://github.com/owner/repo.git");
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });

  it("returns null for invalid URL", () => {
    expect(parseGitRemote("not-a-url")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseGitRemote("")).toBeNull();
  });

  it("handles repos with hyphens and dots in names", () => {
    const result = parseGitRemote("git@github.com:my-org/my-repo-name");
    expect(result).toEqual({ owner: "my-org", repo: "my-repo-name" });
  });
});

describe("parsePrUrl", () => {
  it("parses valid PR URL", () => {
    const result = parsePrUrl("https://github.com/owner/repo/pull/123");
    expect(result).toEqual({ owner: "owner", repo: "repo", number: 123 });
  });

  it("parses PR URL with extra path segments", () => {
    const result = parsePrUrl(
      "https://github.com/owner/repo/pull/456/files",
    );
    expect(result).toEqual({ owner: "owner", repo: "repo", number: 456 });
  });

  it("returns null for invalid URL", () => {
    expect(parsePrUrl("not-a-url")).toBeNull();
  });

  it("returns null for non-PR GitHub URL", () => {
    expect(parsePrUrl("https://github.com/owner/repo/issues/123")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parsePrUrl("")).toBeNull();
  });
});
