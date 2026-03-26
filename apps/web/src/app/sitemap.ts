import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = siteConfig.url;

  return [
    {
      changeFrequency: "daily",
      lastModified: new Date(),
      priority: 1,
      url: baseUrl,
    },
  ];
}
