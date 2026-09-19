import type { ExistingIssue, IssuePublisher, IssueRepository, PublishedIssue } from "./types";

export class MemoryIssuePublisher implements IssuePublisher {
  readonly issues: ExistingIssue[] = [];
  readonly comments: string[] = [];
  createCalls = 0;

  async findByMarker(_repo: IssueRepository, marker: string) {
    return this.issues.find((issue) => issue.body.includes(marker)) ?? null;
  }

  async create(
    _repo: IssueRepository,
    input: { title: string; body: string; labels: string[] },
  ): Promise<PublishedIssue> {
    this.createCalls += 1;
    const issue = {
      number: this.issues.length + 1,
      url: `https://github.com/example/repo/issues/${this.issues.length + 1}`,
      state: "open" as const,
      body: `${input.title}\n${input.body}\n${input.labels.join(",")}`,
    };
    this.issues.push(issue);
    return issue;
  }

  async comment(_repo: IssueRepository, number: number, body: string) {
    this.comments.push(`${number}:${body}`);
  }
}

export const memoryIssuePublisher = new MemoryIssuePublisher();
