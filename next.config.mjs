/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';
const repo = 'rba2pj.github.io'; // 🔹 GitHub Pages 레포 이름

const nextConfig = {
  // ✅ Next.js 14 static export
  output: isProd ? 'export' : undefined,

  // ✅ 이미지 최적화 비활성화 (GitHub Pages 호환)
  images: { unoptimized: isProd },

  // ✅ GitHub Pages 경로 맞추기
  basePath: isProd ? `/${repo}` : '',
  assetPrefix: isProd ? `/${repo}/` : '',

  // ✅ export 시 링크 깨짐 방지
  trailingSlash: true,
};

export default nextConfig;
