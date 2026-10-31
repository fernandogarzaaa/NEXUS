import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `pg` is a Node-only driver with optional native bindings; keep it out of
  // the server bundle and require it at runtime instead.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
