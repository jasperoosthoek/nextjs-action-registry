/** Spike — minimal Next app to verify server-action registration of factory-returned exports. */
/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
};
export default nextConfig;
