import { json, route } from "@/lib/api";
import { providerStatus } from "@/providers";

export const GET = route(async () => json({ ok: true, providers: providerStatus() }));
