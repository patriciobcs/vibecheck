import { describe, expect, it } from "vitest";
import { issueAssignmentToken, verifyAssignmentToken } from "./assignment-token";

describe("assignment token", () => {
  it("round-trips assignment and participant ids", async () => {
    const token = await issueAssignmentToken({
      assignmentId: "assignment_1",
      participantId: "participant_1",
    });
    expect(await verifyAssignmentToken(token)).toEqual({
      assignmentId: "assignment_1",
      participantId: "participant_1",
    });
  });

  it("rejects a tampered token", async () => {
    const token = await issueAssignmentToken({ assignmentId: "a", participantId: "p" });
    expect(await verifyAssignmentToken(`${token}x`)).toBeNull();
  });

  it("rejects an events token used as an assignment token", async () => {
    const { issueEventsToken } = await import("./session-token");
    const token = await issueEventsToken({ sessionId: "s", participantId: "p" });
    expect(await verifyAssignmentToken(token)).toBeNull();
  });
});
