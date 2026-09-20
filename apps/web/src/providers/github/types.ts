import type { GithubRepoBinding } from "@vibecheck/contracts";

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
  findComment(repo: IssueRepository, number: number, marker: string): Promise<boolean>;
  create(
    repo: IssueRepository,
    input: { title: string; body: string; labels: string[] },
  ): Promise<PublishedIssue>;
  comment(repo: IssueRepository, number: number, body: string): Promise<void>;
  getDefaultBranch(repo: IssueRepository): Promise<string>;
}

export interface RepoPublisher extends IssuePublisher {
  getBranchSha(repo: IssueRepository, branch: string): Promise<string | null>;
  getCommit?(repo: IssueRepository, commitSha: string): Promise<boolean>;
  compareFiles(repo: IssueRepository, base: string, head: string): Promise<string[]>;
  createDraftPullRequest(
    repo: IssueRepository,
    input: { title: string; head: string; base: string; body: string },
  ): Promise<DraftPullRequest>;
}
