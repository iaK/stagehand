import * as repo from "./repositories";

export interface ProjectConventions {
  commitFormat: string | null;
  branchNaming: string | null;
  prTemplate: string | null;
  extraRules: string | null;
  /** Pre-assembled full rules string (all non-empty sections joined). */
  fullRules: string | null;
}

export async function loadConventions(projectId: string): Promise<ProjectConventions> {
  const [commitFormat, branchNaming, prTemplate, extraRules, fullRules] = await Promise.all([
    repo.getProjectSetting(projectId, "conv_commit_format"),
    repo.getProjectSetting(projectId, "conv_branch_naming"),
    repo.getProjectSetting(projectId, "conv_pr_template"),
    repo.getProjectSetting(projectId, "conv_extra_rules"),
    repo.getProjectSetting(projectId, "github_commit_rules"),
  ]);

  return { commitFormat, branchNaming, prTemplate, extraRules, fullRules };
}
