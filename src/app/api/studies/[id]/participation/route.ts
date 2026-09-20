import { NextRequest } from "next/server";
import { z } from "zod";
import { tenantFromRequest, apiError } from "@/lib/auth";
import { participationEventSchema } from "@/contracts/participation";
import { recordParticipation } from "@/services/participation";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await tenantFromRequest(request);
  if (!tenantId) return apiError("authentication required", "unauthorized", 401);
  const body = participationEventSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json(
      {
        error: {
          code: "invalid_input",
          message: "invalid participation event",
          issues: body.error.issues,
        },
      },
      { status: 422 },
    );
  }
  try {
    return Response.json(await recordParticipation(tenantId, (await params).id, body.data), {
      status: 201,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: { code: "invalid_input", message: error.message } },
        { status: 422 },
      );
    }
    if (error instanceof Error && error.message === "study_not_found") {
      return apiError("study not found", "not_found", 404);
    }
    return apiError(error instanceof Error ? error.message : "invalid participation");
  }
}
