/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Uploads (school logo) are written through lib/storage.ts; allow large bodies
  // for the JSON API (attempt autosave batches, question imports).
  experimental: {
    serverActions: {
      bodySizeLimit: '8mb',
    },
  },
}

export default nextConfig
