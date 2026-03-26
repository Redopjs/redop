import type { Metadata } from "next";
import "@/styles/globals.css";
import { SITE_KEYWORDS, siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";
import { geistMono, geistSans } from "@/styles/fonts";

export const metadata: Metadata = {
  authors: [{ name: "Evans Maina" }],
  creator: "Evans Maina",
  description: siteConfig.description,
  keywords: SITE_KEYWORDS,
  metadataBase: new URL(siteConfig.url),
  openGraph: {
    title: siteConfig.title,
    description: siteConfig.description,
    url: siteConfig.url,
    type: "website",
    siteName: siteConfig.name,
    locale: "en_US",
    images: [
      {
        url: `${siteConfig.url}/og.png`,
        width: 1200,
        height: 630,
        alt: siteConfig.title,
      },
    ],
  },
  publisher: "UseAgents",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  title: {
    default: siteConfig.title,
    template: `%s - ${siteConfig.name}`,
  },
  twitter: {
    card: "summary_large_image",
    title: siteConfig.title,
    description: siteConfig.description,
    creator: "@UseAgents",
    images: [
      {
        url: `${siteConfig.url}/og.png`,
        width: 1200,
        height: 630,
        alt: siteConfig.title,
      },
    ],
  },
};

export const viewport = {
  initialScale: 1,
  maximumScale: 1,
  themeColor: [{ media: "(prefers-color-scheme: light)" }],
  userScalable: false,
  width: "device-width",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={cn(
          geistMono.variable,
          geistSans.variable,
          "font-sans antialiased"
        )}
      >
        {children}
      </body>
    </html>
  );
}
