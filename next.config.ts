import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // ffmpeg-static resolves its binary from __dirname, so it must stay an external require,
  // and the binary isn't imported by anything, so the tracer needs it named explicitly.
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/ffmpeg-static/ffmpeg", "./node_modules/.pnpm/ffmpeg-static@*/node_modules/ffmpeg-static/ffmpeg"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
