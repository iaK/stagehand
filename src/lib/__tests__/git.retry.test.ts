import { vi } from "vitest";

// Mock retry constants to use tiny delays for fast tests
vi.mock("../constants", async (importOriginal) => {
  const original = await importOriginal<typeof import("../constants")>();
  return {
    ...original,
    RETRY_BASE_DELAY_MS: 1,
    RETRY_MAX_DELAY_MS: 2,
  };
});

import { ghFetchPrReviews } from "../git";
import { invoke } from "../../test/mocks/tauri";

afterEach(() => {
  invoke.mockReset();
});

describe("runGhWithRetry (via ghFetchPrReviews)", () => {
  it("retries on rate limit error and succeeds", async () => {
    invoke
      .mockRejectedValueOnce(new Error("API rate limit exceeded"))
      .mockResolvedValueOnce("[]");

    const result = await ghFetchPrReviews("/repo", "owner", "repo", 1);
    expect(result).toEqual([]);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("retries on HTTP 5xx error and succeeds", async () => {
    invoke
      .mockRejectedValueOnce(new Error("HTTP 502 Bad Gateway"))
      .mockResolvedValueOnce("[]");

    const result = await ghFetchPrReviews("/repo", "owner", "repo", 1);
    expect(result).toEqual([]);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("retries on connection refused error and succeeds", async () => {
    invoke
      .mockRejectedValueOnce(new Error("connect: connection refused"))
      .mockResolvedValueOnce("[]");

    const result = await ghFetchPrReviews("/repo", "owner", "repo", 1);
    expect(result).toEqual([]);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("retries on 'Failed to run gh' error and succeeds", async () => {
    invoke
      .mockRejectedValueOnce(new Error("Failed to run gh: exit code 1"))
      .mockResolvedValueOnce("[]");

    const result = await ghFetchPrReviews("/repo", "owner", "repo", 1);
    expect(result).toEqual([]);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("does not retry on non-retryable error", async () => {
    invoke.mockRejectedValue(new Error("gh: Not Found (HTTP 404)"));

    await expect(
      ghFetchPrReviews("/repo", "owner", "repo", 1),
    ).rejects.toThrow("Not Found");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("exhausts retries on persistent 5xx error", async () => {
    invoke.mockRejectedValue(new Error("HTTP 500 Internal Server Error"));

    await expect(
      ghFetchPrReviews("/repo", "owner", "repo", 1),
    ).rejects.toThrow("HTTP 500");
    expect(invoke).toHaveBeenCalledTimes(3);
  });
});
