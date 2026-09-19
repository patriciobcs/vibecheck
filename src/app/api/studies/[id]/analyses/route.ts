import { NextRequest } from "next/server";
import { z } from "zod";
import { tenantFromRequest, apiError } from "@/lib/auth";
import { startAnalysis } from "@/services/analyses";

const inputSchema = z.object({
  session_id: z.string().min(1),
  provider: z.enum(["fixture", "devin"]).optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await tenantFromRequest(request);
  if (!tenantId) return apiError("authentication required", "unauthorized", 401);
  try {
    const input = inputSchema.parse(await request.json());
    const result = await startAnalysis(
      tenantId,
      (await params).id,
      input.session_id,
      input.provider,
    );
    if (!result) return apiError("published study not found", "not_found", 404);
    return Response.json(result, { status: result.status });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        {
          error: { code: "invalid_input", message: "invalid analysis input", issues: error.issues },
        },
        { status: 400 },
      );
    }
    return apiError(error instanceof Error ? error.message : "invalid analysis");
  }
}
