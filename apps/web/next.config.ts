import type { NextConfig } from "next";

/** Dev-only: let the public tunnel hostname load Next's dev assets and HMR socket. */
const tunnelHost = (() => {
  try {
    const url = process.env.PUBLIC_WEBHOOK_BASE_URL;
    return url && !/localhost|127\.0\.0\.1/.test(url) ? new URL(url).host : null;
  } catch {
    return null;
  }
})();

const nextConfig: NextConfig = {
  allowedDevOrigins: tunnelHost ? [tunnelHost] : [],
};

export default nextConfig;
