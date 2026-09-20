import type { ExistingIssue, IssueRepository, PublishedIssue, RepoPublisher } from "./types";

export class MemoryIssuePublisher implements RepoPublisher {
  private readonly defaultBranch: string;
  private readonly branchSha: string | null;
  private readonly commits: Set<string> | null;
  readonly issues: ExistingIssue[] = [];
  readonly comments: string[] = [];
  createCalls = 0;
  constructor(
    options: { defaultBranch?: string; branchSha?: string | null; commits?: string[] } = {},
  ) {
    this.defaultBranch = options.defaultBranch ?? "master";
    this.branchSha = options.branchSha === undefined ? "candidate-sha" : options.branchSha;
    this.commits = options.commits ? new Set(options.commits) : null;
  }
  async findByMarker(_repo: IssueRepository, marker: string) {
    return this.issues.find((issue) => issue.body.includes(marker)) ?? null;
  }
  async findComment(_repo: IssueRepository, number: number, marker: string) {
    return this.comments.some(
      (comment) => comment.startsWith(`${number}:`) && comment.includes(marker),
    );
  }
  async create(
    _repo: IssueRepository,
    input: { title: string; body: string; labels: string[] },
  ): Promise<PublishedIssue> {
    this.createCalls += 1;
    const number = this.issues.length + 1;
    this.issues.push({
      number,
      url: `https://github.com/example/repo/issues/${number}`,
      state: "open",
      body: `${input.title}\n${input.body}\n${input.labels.join(",")}`,
    });
    return { number, url: this.issues.at(-1)?.url ?? "" };
  }
  async comment(_repo: IssueRepository, number: number, body: string) {
    this.comments.push(`${number}:${body}`);
  }
  async getDefaultBranch() {
    return this.defaultBranch;
  }
  async getBranchSha(_repo: IssueRepository, branch: string) {
    return branch ? this.branchSha : null;
  }
  async getCommit(_repo: IssueRepository, commitSha: string) {
    return this.commits ? this.commits.has(commitSha) : true;
  }
  async compareFiles() {
    return ["packages/excalidraw/components/Toolbar.tsx"];
  }
  async createDraftPullRequest(
    _repo: IssueRepository,
    _input: { title: string; head: string; base: string; body: string },
  ) {
    return { number: 1, url: "https://github.com/example/repo/pull/1" };
  }
}

export const memoryIssuePublisher = new MemoryIssuePublisher();
