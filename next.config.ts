import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `pg` is a Node-only driver with optional native bindings; keep it out of
  // the server bundle and require it at runtime instead.
  serverExternalPackages: ["pg"],
  // Ops documents are read at runtime by the knowledge layer (lib/knowledge);
  // ship them with the routes that answer questions.
  outputFileTracingIncludes: {
    "/api/v1/ask": ["./docs/ops/**/*"],
    "/api/mcp": ["./docs/ops/**/*"],
  },
};

export default nextConfig;
