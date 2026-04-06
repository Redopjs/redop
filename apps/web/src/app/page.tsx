"use client";

import {
  Activity,
  Box,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  Shield,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { Icons } from "@/components/icons";
import { Button } from "@/components/ui/button";

const exampleCode = `import { Redop } from "@redopjs/redop";
import { z } from "zod";

new Redop({
  serverInfo: {
    name: "docs-server",
    title: "Docs Server",
    version: "0.1.0",
    description: "Search docs and return answers.",
  },
})
  .tool("search_docs", {
    description: "Search internal docs",
    inputSchema: z.object({
      query: z.string().min(1),
    }),
    handler: ({ input }) => ({
      query: input.query,
      results: [],
    }),
  })
  .listen(3000);`;

export default function Home() {
  const [copied, setCopied] = useState(false);

  const command = "bun create redop-app";

  const handleCopy = () => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      {/* Navbar */}
      <header className="sticky top-0 z-50 w-full border-redop-border border-b bg-redop-warm/90 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-[95rem] items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <Icons.Logo className="w-16 sm:w-20" />
          <nav className="flex items-center gap-4 font-mono text-xs text-redop-ink/70 uppercase tracking-wider sm:gap-6 sm:text-sm">
            <Link
              className="transition-colors hover:text-redop-primary"
              href="/docs"
            >
              Docs
            </Link>
            <Link
              className="transition-colors hover:text-redop-primary"
              href="https://github.com/evansso/redop"
              rel="noreferrer"
            >
              GitHub
            </Link>
          </nav>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-[95rem] flex-1 flex-col px-4 sm:px-6 lg:px-8">
        {/* Hero Section */}
        <section className="grid items-center gap-10 py-10 sm:gap-12 sm:py-14 md:gap-16 md:py-20 lg:grid-cols-2 lg:py-24">
          <div>
            <h1 className="mb-6 font-normal text-4xl text-redop-ink leading-[1.1] tracking-tight sm:mb-8 sm:text-5xl">
              Bun-native framework for building{" "}
              <span className="text-redop-primary">production MCP servers.</span>
            </h1>

            <p className="mb-8 max-w-2xl text-base text-muted-foreground leading-relaxed sm:mb-10 sm:text-lg md:text-xl">
              Define tools, validate input, compose middleware, and ship MCP
              servers with a small explicit API. Start with one tool, then add
              resources, prompts, hooks, and plugins when you need them.
            </p>

            <div className="flex flex-col gap-8 sm:gap-10">
              <div className="flex w-full max-w-md items-center justify-between gap-3 rounded-lg border border-redop-ink/20 border-dashed bg-transparent px-4 py-3 font-mono text-redop-ink text-xs sm:px-5 sm:text-sm">
                <span className="min-w-0 break-all sm:break-normal">
                  {command}
                </span>
                <Button onClick={handleCopy} size={"icon"} variant={"ghost"}>
                  {copied ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>

              <div className="flex flex-col gap-4">
                <span className="font-mono text-redop-ink/50 text-xs sm:text-sm">
                  Used by
                </span>
                <Link href="https://useagents.site">
                  <Image
                    alt="UseAgents"
                    className="opacity-80 transition-opacity hover:opacity-100"
                    height={24}
                    src="/logo-dark.svg"
                    width={100}
                  />
                </Link>
              </div>
            </div>
          </div>

          <div className="group relative min-w-0">
            <div className="absolute -inset-1 rounded-xl bg-gradient-to-r from-redop-primary/20 to-redop-accent/20 opacity-50 blur transition duration-1000 group-hover:opacity-100 group-hover:duration-200" />
            <div className="relative overflow-hidden rounded-xl border border-redop-border bg-redop-panel shadow-sm">
              <div className="flex items-center border-redop-border border-b bg-redop-warm/50 px-4 py-3">
                <div className="flex gap-2">
                  <div className="h-3 w-3 rounded-full bg-redop-ink/20" />
                  <div className="h-3 w-3 rounded-full bg-redop-ink/20" />
                  <div className="h-3 w-3 rounded-full bg-redop-ink/20" />
                </div>
                <div className="ml-4 font-mono text-redop-ink/50 text-xs">
                  server.ts
                </div>
              </div>
              <div className="overflow-x-auto p-4 sm:p-6">
                <pre className="font-mono text-redop-ink text-xs leading-relaxed sm:text-sm">
                  <code>{exampleCode}</code>
                </pre>
              </div>
            </div>
          </div>
        </section>

        {/* Proof Strip */}
        <section className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t py-6 font-mono text-muted-foreground text-xs uppercase tracking-wider sm:gap-x-8 sm:gap-y-4 sm:py-8 sm:text-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-redop-primary/60" /> Typed
            tools
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-redop-primary/60" /> Zod
            inference
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-redop-primary/60" />{" "}
            Middleware + plugins
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-redop-primary/60" /> HTTP +
            stdio
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-redop-primary/60" />{" "}
            Bun-native
          </div>
        </section>

        {/* Features Section */}
        <section className="border-redop-border border-t py-16 sm:py-20 lg:py-24">
          <div className="mb-10 sm:mb-16">
            <h2 className="mb-4 font-normal text-3xl tracking-tight sm:text-4xl">
              Everything you need.
            </h2>
            <p className="max-w-2xl text-base text-redop-ink/70 sm:text-lg">
              Built-in primitives for the real world. Stop writing the same
              validation and transport layers.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {[
              {
                desc: "Define tools with full TS inference using Zod v4, Standard Schema, or JSON Schema.",
                icon: <Code2 className="h-5 w-5 text-redop-primary" />,
                title: "Typed Tools",
              },
              {
                desc: "Add middleware for auth, rate limiting, and caching to control request flow.",
                icon: <Shield className="h-5 w-5 text-redop-primary" />,
                title: "Middleware",
              },
              {
                desc: "Global and tool-local before/after hooks for analytics and observability.",
                icon: <Activity className="h-5 w-5 text-redop-primary" />,
                title: "Lifecycle Hooks",
              },
              {
                desc: "Build and share reusable framework extensions across your MCP servers.",
                icon: <Box className="h-5 w-5 text-redop-primary" />,
                title: "Plugin System",
              },
            ].map((feature) => (
              <div
                className="rounded-xl border border-redop-border bg-redop-panel p-6"
                key={feature.title}
              >
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-redop-soft">
                  {feature.icon}
                </div>
                <h3 className="mb-2 font-normal">{feature.title}</h3>
                <p className="text-redop-ink/70 leading-relaxed">
                  {feature.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Philosophy Section */}
        <section className="border-redop-border border-t py-16 sm:py-20 lg:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="mb-6 font-normal text-2xl tracking-tight sm:text-3xl">
              Philosophy
            </h2>
            <div className="mt-10 grid gap-8 text-left sm:mt-12 sm:grid-cols-3">
              <div>
                <div className="mb-2 font-mono text-redop-primary text-sm">
                  01. Small API
                </div>
                <h3 className="mb-2 font-normal">Minimal surface</h3>
                <p className="text-redop-ink/70 text-sm leading-relaxed">
                  Learn it in 5 minutes. No magic, just clean composition of
                  standard web patterns.
                </p>
              </div>
              <div>
                <div className="mb-2 font-mono text-redop-primary">
                  02. Typed by default
                </div>
                <h3 className="mb-2 font-normal">End-to-end safety</h3>
                <p className="text-redop-ink/70 text-sm leading-relaxed">
                  If it compiles, it works. Inputs, contexts, and returns are
                  strictly typed.
                </p>
              </div>
              <div>
                <div className="mb-2 font-mono text-redop-primary">
                  03. For real apps
                </div>
                <h3 className="mb-2 font-normal">Production ready</h3>
                <p className="text-redop-ink/70 text-sm leading-relaxed">
                  Built for real MCP apps with auth, rate limiting, and logging,
                  not just toy demos.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="z-10 mt-auto w-full border-redop-border border-t bg-redop-panel py-8">
        <div className="mx-auto flex w-full max-w-[95rem] flex-col items-center justify-between gap-4 px-4 text-center sm:px-6 md:flex-row md:text-left lg:px-8">
          <Icons.Logo className="w-16 sm:w-20" />
          <div className="font-mono text-sm text-muted-foreground uppercase sm:text-base md:text-lg">
            © 2026 UseAgents. MIT Licensed.
          </div>
        </div>
      </footer>
    </div>
  );
}
