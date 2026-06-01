import type { NextConfig } from "next";
import path from "path";
import { config as loadDotenv } from "dotenv";

// Load the root .env so GROQ_API_KEY is available in Next.js API routes
loadDotenv({ path: path.join(__dirname, "..", ".env") });

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "mammoth"],
};

export default nextConfig;
