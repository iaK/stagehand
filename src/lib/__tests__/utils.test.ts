import { cn } from "../utils";

describe("cn", () => {
  it("merges multiple class names", () => {
    const result = cn("foo", "bar");
    expect(result).toBe("foo bar");
  });

  it("handles conflicting Tailwind classes", () => {
    const result = cn("p-2", "p-4");
    expect(result).toBe("p-4");
  });

  it("filters falsy values", () => {
    const result = cn("foo", false && "bar", undefined, null, "baz");
    expect(result).toBe("foo baz");
  });

  it("handles conditional classes", () => {
    const isActive = true;
    const isDisabled = false;
    const result = cn(
      "base",
      isActive && "active",
      isDisabled && "disabled",
    );
    expect(result).toBe("base active");
  });

  it("handles empty input", () => {
    const result = cn();
    expect(result).toBe("");
  });
});
