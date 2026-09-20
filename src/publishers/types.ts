import type { GithubRepoBinding } from "@/contracts/repoBinding";

export type IssueRepository = Pick<GithubRepoBinding, "owner" | "repo">;
export type PublishedIssue = { number: number; url: string };
export type ExistingIssue = {
  number: number;
  url: string;
  state: "open" | "closed";
  body: string;
};
export type DraftPullRequest = { number: number; url: string };

export interface IssuePublisher {
  findByMarker(repo: IssueRepository, marker: string): Promise<ExistingIssue | null>;
  create(
    repo: IssueRepository,
    input: { title: string; body: string; labels: string[] },
  ): Promise<PublishedIssue>;
  comment(repo: IssueRepository, number: number, body: string): Promise<void>;
}

export interface RepoPublisher extends IssuePublisher {
  getDefaultBranch(repo: IssueRepository): Promise<string>;
  getBranchSha(repo: IssueRepository, branch: string): Promise<string | null>;
  getCommit?(repo: IssueRepository, commitSha: string): Promise<boolean>;
  compareFiles(repo: IssueRepository, base: string, head: string): Promise<string[]>;
  createDraftPullRequest(
    repo: IssueRepository,
    input: { title: string; head: string; base: string; body: string },
  ): Promise<DraftPullRequest>;
}
