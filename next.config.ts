import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  eslint: { ignoreDuringBuilds: true },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  webpack: (config: any) => {
    config.resolve = config.resolve ?? {};
    config.resolve.fallback = {
      ...(config.resolve.fallback ?? {}),
      buffer: false,
      crypto: false,
      stream: false,
      path: false,
      fs: false,
    };
    return config;
  },
};

export default nextConfig;
