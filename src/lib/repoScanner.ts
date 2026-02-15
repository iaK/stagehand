import { readFileContents } from "./git";
import * as repo from "./repositories";
import * as path from "@tauri-apps/api/path";

const CONVENTION_FILES = [
  "CONTRIBUTING.md",
  "CLAUDE.md",
  ".claude/settings.json",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/COMMIT_CONVENTION.md",
  ".husky/pre-commit",
  ".husky/commit-msg",
  ".commitlintrc",
  ".commitlintrc.json",
  ".commitlintrc.yml",
  "commitlint.config.js",
  "commitlint.config.cjs",
  ".prettierrc",
  ".eslintrc",
  ".eslintrc.json",
];

/** Extract sections from markdown that match convention-related keywords */
function extractConventionSections(markdown: string): string | null {
  const keywords = [
    "commit",
    "branch",
    "contributing",
    "pull request",
    "convention",
    "style guide",
    "naming",
    "workflow",
  ];

  const lines = markdown.split("\n");
  const sections: string[] = [];
  let currentSection: string[] = [];
  let currentHeader = "";
  let isRelevant = false;

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headerMatch) {
      // Save previous section if relevant
      if (isRelevant && currentSection.length > 0) {
        sections.push(currentSection.join("\n"));
      }
      currentHeader = headerMatch[2].toLowerCase();
      isRelevant = keywords.some((kw) => currentHeader.includes(kw));
      currentSection = [line];
    } else {
      currentSection.push(line);
    }
  }

  // Don't forget last section
  if (isRelevant && currentSection.length > 0) {
    sections.push(currentSection.join("\n"));
  }

  return sections.length > 0 ? sections.join("\n\n") : null;
}

/** Extract just the "scripts" section from package.json */
function extractPackageScripts(content: string): string | null {
  try {
    const pkg = JSON.parse(content);
    if (pkg.scripts && Object.keys(pkg.scripts).length > 0) {
      return JSON.stringify(pkg.scripts, null, 2);
    }
  } catch {
    // ignore
  }
  return null;
}

export async function scanRepository(
  projectId: string,
  projectPath: string,
): Promise<string> {
  const sections: Record<string, string[]> = {
    "Commit Conventions": [],
    "Branch Naming": [],
    "PR Templates": [],
    "CI/CD & Hooks": [],
    "Project Rules": [],
  };

  // Helper to read a file relative to project root
  const readFile = async (relativePath: string): Promise<string | null> => {
    const fullPath = await path.join(projectPath, relativePath);
    return readFileContents(fullPath);
  };

  // Scan all convention files in parallel
  const fileResults = await Promise.allSettled(
    CONVENTION_FILES.map(async (file) => ({
      file,
      content: await readFile(file),
    })),
  );

  // Also try README.md and package.json
  const [readmeResult, packageResult] = await Promise.allSettled([
    readFile("README.md"),
    readFile("package.json"),
  ]);

  // Process README.md
  if (readmeResult.status === "fulfilled" && readmeResult.value) {
    const conventionSections = extractConventionSections(readmeResult.value);
    if (conventionSections) {
      sections["Commit Conventions"].push(
        `### From README.md\n${conventionSections}`,
      );
    }
  }

  // Process package.json
  if (packageResult.status === "fulfilled" && packageResult.value) {
    const scripts = extractPackageScripts(packageResult.value);
    if (scripts) {
      sections["CI/CD & Hooks"].push(
        `### package.json scripts\n\`\`\`json\n${scripts}\n\`\`\``,
      );
    }
  }

  // Process convention files
  for (const result of fileResults) {
    if (result.status !== "fulfilled" || !result.value.content) continue;
    const { file, content } = result.value;

    if (file === "CONTRIBUTING.md") {
      const conventionSections = extractConventionSections(content);
      if (conventionSections) {
        sections["Commit Conventions"].push(
          `### From CONTRIBUTING.md\n${conventionSections}`,
        );
      }
    } else if (
      file.startsWith(".commitlintrc") ||
      file.startsWith("commitlint.config")
    ) {
      sections["Commit Conventions"].push(
        `### ${file}\n\`\`\`\n${content}\n\`\`\``,
      );
    } else if (file.startsWith(".husky/")) {
      sections["CI/CD & Hooks"].push(
        `### ${file}\n\`\`\`sh\n${content}\n\`\`\``,
      );
    } else if (file === ".github/PULL_REQUEST_TEMPLATE.md") {
      sections["PR Templates"].push(
        `### Pull Request Template\n${content}`,
      );
    } else if (file === ".github/COMMIT_CONVENTION.md") {
      sections["Commit Conventions"].push(
        `### Commit Convention\n${content}`,
      );
    } else if (file === "CLAUDE.md" || file === ".claude/settings.json") {
      sections["Project Rules"].push(`### ${file}\n\`\`\`\n${content}\n\`\`\``);
    } else if (
      file === ".prettierrc" ||
      file === ".eslintrc" ||
      file === ".eslintrc.json"
    ) {
      // These are less critical but can inform style
      // Only include if small enough
      if (content.length < 2000) {
        sections["Project Rules"].push(
          `### ${file}\n\`\`\`json\n${content}\n\`\`\``,
        );
      }
    }
  }

  // Assemble the document
  const parts: string[] = [];
  for (const [heading, items] of Object.entries(sections)) {
    if (items.length > 0) {
      parts.push(`## ${heading}\n\n${items.join("\n\n")}`);
    }
  }

  const document =
    parts.length > 0
      ? parts.join("\n\n---\n\n")
      : "No repository conventions found.";

  // Store the assembled document
  await repo.setProjectSetting(projectId, "github_commit_rules", document);

  // Also populate individual convention fields (only if not already set by user)
  const existingCommit = await repo.getProjectSetting(projectId, "conv_commit_format");
  const existingBranch = await repo.getProjectSetting(projectId, "conv_branch_naming");
  const existingPr = await repo.getProjectSetting(projectId, "conv_pr_template");

  if (!existingCommit && sections["Commit Conventions"].length > 0) {
    await repo.setProjectSetting(
      projectId,
      "conv_commit_format",
      sections["Commit Conventions"].join("\n\n"),
    );
  }
  if (!existingBranch && sections["Branch Naming"].length > 0) {
    await repo.setProjectSetting(
      projectId,
      "conv_branch_naming",
      sections["Branch Naming"].join("\n\n"),
    );
  }
  if (!existingPr && sections["PR Templates"].length > 0) {
    await repo.setProjectSetting(
      projectId,
      "conv_pr_template",
      sections["PR Templates"].join("\n\n"),
    );
  }

  return document;
}
