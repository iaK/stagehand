import { extractConventionSections, extractPackageScripts } from "../repoScanner";

describe("extractConventionSections", () => {
  it("extracts sections with matching headers", () => {
    const markdown = `# Project

## Commit Convention
Use conventional commits.

## Installation
Run npm install.

## Branch Naming
Use feature/ prefix.
`;
    const result = extractConventionSections(markdown);
    expect(result).toContain("Commit Convention");
    expect(result).toContain("Use conventional commits.");
    expect(result).toContain("Branch Naming");
    expect(result).toContain("Use feature/ prefix.");
    expect(result).not.toContain("Installation");
  });

  it("returns null when no matching headers exist", () => {
    const markdown = `# Project

## Installation
Run npm install.

## Usage
Import and use.
`;
    const result = extractConventionSections(markdown);
    expect(result).toBeNull();
  });

  it("extracts only relevant sections from mixed content", () => {
    const markdown = `## Setup
Do setup things.

## Contributing Guidelines
Follow these rules.

## Testing
Run tests.
`;
    const result = extractConventionSections(markdown);
    expect(result).toContain("Contributing Guidelines");
    expect(result).not.toContain("Setup");
    expect(result).not.toContain("Testing");
  });

  it("returns null for empty string", () => {
    expect(extractConventionSections("")).toBeNull();
  });

  it("handles content with no headers at all", () => {
    const result = extractConventionSections("Just some text without headers.");
    expect(result).toBeNull();
  });

  it("matches keyword 'workflow'", () => {
    const markdown = `## Development Workflow
Step 1, Step 2.
`;
    const result = extractConventionSections(markdown);
    expect(result).toContain("Development Workflow");
  });
});

describe("extractPackageScripts", () => {
  it("returns JSON string of scripts when present", () => {
    const content = JSON.stringify({
      name: "my-app",
      scripts: {
        dev: "vite",
        build: "tsc && vite build",
        test: "vitest",
      },
    });
    const result = extractPackageScripts(content);
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed).toEqual({
      dev: "vite",
      build: "tsc && vite build",
      test: "vitest",
    });
  });

  it("returns null when no scripts field exists", () => {
    const content = JSON.stringify({ name: "my-app", version: "1.0.0" });
    expect(extractPackageScripts(content)).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(extractPackageScripts("not json")).toBeNull();
  });

  it("returns null for empty scripts object", () => {
    const content = JSON.stringify({ name: "my-app", scripts: {} });
    expect(extractPackageScripts(content)).toBeNull();
  });
});
