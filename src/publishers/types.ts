import type { GithubRepoBinding } from "@/contracts/repoBinding";

export type IssueRepository = Pick<GithubRepoBinding, "owner" | "repo">;
export type PublishedIssue = { number: number; url: string };
export type ExistingIssue = {
  number: number;
  url: string;
  state: "open" | "closed";
  body: string;
};

export interface IssuePublisher {
  findByMarker(repo: IssueRepository, marker: string): Promise<ExistingIssue | null>;
  create(
    repo: IssueRepository,
    input: { title: string; body: string; labels: string[] },
  ): Promise<PublishedIssue>;
  comment(repo: IssueRepository, number: number, body: string): Promise<void>;
}
