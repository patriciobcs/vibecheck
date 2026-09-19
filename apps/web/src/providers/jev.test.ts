import { describe, expect, it } from "vitest";
import { createJevClient, JevProviderError } from "./jev";

const questions = { ux_friction_observed: { type: "noul" as const, instructions: "x" } };

function fetchWith(status: number, body: unknown): typeof fetch {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "x-request-id": "req_1" },
    });
}

describe("createJevClient", () => {
  it("posts model, state and questions with a bearer token and returns validated answers, usage and request id", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: { ux_friction_observed: { type: "noul", noul: 0.9 } },
          usage: { input_tokens: 10, output_tokens: 2 },
        }),
        { status: 200, headers: { "x-request-id": "req_9" } },
      );
    };
    const client = createJevClient(
      { apiKey: "k", baseUrl: "https://api.typesafe.ai", model: "jev-latest" },
      fetchImpl,
    );
    const res = await client.evaluate({ state: { a: 1 }, questions });
    const captured = calls[0];
    if (!captured) throw new Error("no request captured");
    expect(captured.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect((captured.init.headers as Record<string, string>).Authorization).toBe("Bearer k");
    expect(JSON.parse(String(captured.init.body))).toEqual({
      model: "jev-latest",
      state: { a: 1 },
      questions,
    });
    expect(res).toEqual({
      model: "jev-1.13.0",
      answers: { ux_friction_observed: { type: "noul", noul: 0.9 } },
      usage: { input_tokens: 10, output_tokens: 2 },
      requestId: "req_9",
    });
  });

  it("classifies 429 and 529 as transient, 401/422 as permanent", async () => {
    const client = (s: number) =>
      createJevClient(
        { apiKey: "k", baseUrl: "https://api.typesafe.ai", model: "jev-latest" },
        fetchWith(s, { error: "x" }),
      );
    await expect(client(429).evaluate({ state: {}, questions })).rejects.toMatchObject({
      transient: true,
      status: 429,
    });
    await expect(client(529).evaluate({ state: {}, questions })).rejects.toMatchObject({
      transient: true,
    });
    await expect(client(422).evaluate({ state: {}, questions })).rejects.toMatchObject({
      transient: false,
      status: 422,
    });
    await expect(client(401).evaluate({ state: {}, questions })).rejects.toBeInstanceOf(
      JevProviderError,
    );
  });

  it("rejects a malformed response body as a permanent error", async () => {
    const client = createJevClient(
      { apiKey: "k", baseUrl: "https://api.typesafe.ai", model: "jev-latest" },
      fetchWith(200, { answers: "nope" }),
    );
    await expect(client.evaluate({ state: {}, questions })).rejects.toMatchObject({
      transient: false,
      code: "malformed_response",
    });
  });
});
