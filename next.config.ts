import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  // Scanned documents (PDF or photo, up to 15 MB) are uploaded through server actions.
  experimental: { serverActions: { bodySizeLimit: "16mb" } },
};

export default createNextIntlPlugin("./src/i18n/request.ts")(nextConfig);
