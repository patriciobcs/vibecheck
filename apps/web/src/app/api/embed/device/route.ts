import { issueDeviceToken } from "@/domain/device-participants";
import { json, route } from "@/lib/api";

/**
 * Issues an anonymous device participant for the embedded dialog. Called from the dialog iframe
 * (VibeCheck origin), so the token stays in VibeCheck-origin storage and never reaches the host page.
 */
export const POST = route(async () => {
  const { token } = await issueDeviceToken();
  return json({ device_token: token });
});
