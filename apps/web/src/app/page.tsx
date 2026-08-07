"use client";

import {
  Activity,
  Code2,
  Globe2,
  Layers3,
  Shield,
  Terminal,
} from "lucide-react";
import Link from "next/link";

import { Icons } from "@/components/icons";
import { FrameRule, PageFrame } from "@/components/page-frame";
import { RuntimeCode } from "@/components/runtime-code";
import { ThemeToggle } from "@/components/theme-toggle";
import { siteConfig } from "@/config/site";

const features = [
  {
    desc: "Ship the same MCP app on Bun by default, or adapt to Node, Cloudflare, and Vercel.",
    icon: Globe2,
    title: "Runtime agnostic",
  },
  {
    desc: "Define tools with Zod, Standard Schema, TypeBox, or plain JSON Schema and keep inference.",
    icon: Code2,
    title: "Typed tools",
  },
  {
    desc: "Compose auth, rate limits, logging, and custom plugins without bolting on a second framework.",
    icon: Shield,
    title: "Middleware and plugins",
  },
  {
    desc: "Use before, after, and afterResponse hooks for analytics and best-effort work after the reply.",
    icon: Activity,
    title: "Lifecycle hooks",
  },
  {
    desc: "HTTP and stdio from one API, with MCP 2026-07-28 support for scalable deployments.",
    icon: Layers3,
    title: "Transports that fit",
  },
  {
    desc: "Start local in seconds with create-redop-app, then pick a deploy preset when you are ready.",
    icon: Terminal,
    title: "First-class local DX",
  },
];

export default function Home() {
  return (
    <div className="relative flex min-h-screen flex-col bg-redop-warm text-redop-ink">
      <header className="relative z-20">
        <PageFrame>
          <div className="flex items-center justify-between px-4 py-5 sm:px-8">
            <Link aria-label="Redop home" className="text-redop-ink" href="/">
              <Icons.Logo className="w-14 sm:w-16" />
            </Link>
            <nav className="flex items-center gap-4 sm:gap-6">
              <Link
                className="font-mono text-[11px] text-redop-ink/55 uppercase tracking-[0.16em] transition-colors hover:text-redop-ink sm:text-xs"
                href="/docs"
              >
                Docs
              </Link>
              <Link
                className="font-mono text-[11px] text-redop-ink/55 uppercase tracking-[0.16em] transition-colors hover:text-redop-ink sm:text-xs"
                href="https://github.com/Redopjs/redop"
                rel="noreferrer"
              >
                GitHub
              </Link>
              <ThemeToggle />
            </nav>
          </div>
          <FrameRule />
        </PageFrame>
      </header>

      <main className="relative z-10 flex-1">
        <PageFrame>
          <section className="flex flex-col items-center px-4 pt-20 pb-12 text-center sm:px-8 sm:pt-28 sm:pb-16">
            <h1 className="fade-rise mx-auto max-w-3xl font-normal text-[1.85rem] text-redop-ink leading-[1.15] tracking-tight sm:text-4xl md:text-[2.75rem]">
              {siteConfig.tagline}
            </h1>

            <p className="fade-rise fade-rise-delay-1 mx-auto mt-5 max-w-xl text-[15px] text-redop-muted leading-relaxed sm:mt-6 sm:text-base">
              Define tools, resources, and prompts once. Deploy on Bun by
              default, or adapt the same app to Node, Cloudflare Workers, and
              Vercel.
            </p>

            <div className="fade-rise fade-rise-delay-2 mt-8 flex flex-col items-center gap-3 sm:mt-9 sm:flex-row">
              <Link
                className="inline-flex h-10 items-center justify-center rounded-md bg-redop-primary px-4 font-normal text-sm text-white transition-opacity hover:opacity-90"
                href="/docs/getting-started/create-redop-app"
              >
                Start building
              </Link>
              <Link
                className="inline-flex h-10 items-center justify-center rounded-md border border-redop-border bg-transparent px-4 font-normal text-redop-ink text-sm transition-colors hover:bg-redop-ink/[0.04]"
                href="/docs"
              >
                View docs
              </Link>
            </div>

            <div className="fade-rise fade-rise-delay-3 mt-12 w-full max-w-3xl sm:mt-14">
              <RuntimeCode />
            </div>
          </section>

          <FrameRule />

          <section>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3">
              {features.map((feature, index) => {
                const Icon = feature.icon;
                const isLastColDesktop = (index + 1) % 3 === 0;
                const isLastColTablet = index % 2 === 1;
                return (
                  <article
                    className={[
                      "relative px-5 py-8 text-left sm:px-8 sm:py-10",
                      "border-redop-grid border-b",
                      !isLastColTablet ? "sm:border-r" : "",
                      !isLastColDesktop ? "lg:border-r" : "lg:border-r-0",
                      isLastColTablet ? "sm:border-r-0" : "",
                      index >= 4 ? "sm:border-b-0" : "",
                      index >= 3 ? "lg:border-b-0" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    key={feature.title}
                  >
                    <Icon
                      className="mb-4 size-4 text-redop-primary"
                      strokeWidth={1.5}
                    />
                    <h2 className="mb-2 font-normal text-[15px] text-redop-ink tracking-tight sm:text-base">
                      {feature.title}
                    </h2>
                    <p className="text-redop-muted text-sm leading-relaxed">
                      {feature.desc}
                    </p>
                  </article>
                );
              })}
            </div>
          </section>

          <FrameRule />

          <section className="px-4 py-16 text-center sm:px-8 sm:py-20">
            <h2 className="mx-auto max-w-2xl font-normal text-2xl text-redop-ink tracking-tight sm:text-3xl">
              One MCP surface. Many runtimes.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-redop-muted text-sm leading-relaxed sm:text-base">
              Bun stays the default long-running path. Portable adapters expose
              the same handler to Cloudflare, Vercel, and Node — without
              rewriting your tools.
            </p>
          </section>

          <FrameRule />
        </PageFrame>
      </main>

      <footer className="relative z-10">
        <PageFrame>
          <div className="flex flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-8">
            <Icons.Logo className="w-12 text-redop-ink" />
            <p className="font-mono text-[11px] text-redop-ink/40 uppercase tracking-[0.14em]">
              © 2026 UseAgents. MIT Licensed.
            </p>
          </div>
        </PageFrame>
      </footer>
    </div>
  );
}
