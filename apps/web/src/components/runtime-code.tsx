"use client";

import { Check, Copy } from "lucide-react";
import Image from "next/image";
import { type ReactNode, useEffect, useState } from "react";

import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

type RuntimeId = "bun" | "cloudflare" | "vercel" | "node";

type RuntimeExample = {
  id: RuntimeId;
  label: string;
  icon: string;
  iconDark?: string;
  filename: string;
  code: string;
};

const TOOL_BODY = `  .tool("search_docs", {
    description: "Search internal docs",
    inputSchema: z.object({
      query: z.string().min(1),
    }),
    handler: ({ input }) => ({
      query: input.query,
      results: [],
    }),
  })`;

const EXAMPLES: RuntimeExample[] = [
  {
    id: "bun",
    label: "Bun",
    icon: "/runtimes/bun.svg",
    filename: "index.ts",
    code: `import { Redop } from "@redopjs/redop";
import { z } from "zod";

new Redop({
  serverInfo: {
    name: "docs-server",
    title: "Docs Server",
    version: "0.1.0",
    description: "Search docs and return answers.",
  },
})
${TOOL_BODY}
  .listen(3000);`,
  },
  {
    id: "cloudflare",
    label: "Cloudflare",
    icon: "/runtimes/cloudflare-workers.svg",
    filename: "worker.ts",
    code: `import { Redop } from "@redopjs/redop";
import { cloudflare } from "@redopjs/redop/cloudflare";
import { z } from "zod";

const app = new Redop({
  serverInfo: {
    name: "docs-server",
    title: "Docs Server",
    version: "0.1.0",
    description: "Search docs and return answers.",
  },
})
${TOOL_BODY};

export default cloudflare(app);`,
  },
  {
    id: "vercel",
    label: "Vercel",
    icon: "/runtimes/vercel.svg",
    iconDark: "/runtimes/vercel_dark.svg",
    filename: "api/index.ts",
    code: `import { Redop } from "@redopjs/redop";
import { vercel } from "@redopjs/redop/vercel";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";

const app = new Redop({
  serverInfo: {
    name: "docs-server",
    title: "Docs Server",
    version: "0.1.0",
    description: "Search docs and return answers.",
  },
})
${TOOL_BODY};

export default vercel(app, { waitUntil });`,
  },
  {
    id: "node",
    label: "Node.js",
    icon: "/runtimes/nodejs.svg",
    filename: "server.ts",
    code: `import { Redop } from "@redopjs/redop";
import { listenNode } from "@redopjs/redop/node";
import { z } from "zod";

const app = new Redop({
  serverInfo: {
    name: "docs-server",
    title: "Docs Server",
    version: "0.1.0",
    description: "Search docs and return answers.",
  },
})
${TOOL_BODY};

listenNode(app, {
  port: 3000,
  hostname: "0.0.0.0",
});`,
  },
];

function highlightLine(line: string) {
  if (!line) {
    return <span>&nbsp;</span>;
  }

  const parts: ReactNode[] = [];
  const token =
    /(import|from|export|default|new|const|async|await|return)|("[^"]*")|(\.[a-zA-Z_][\w]*)|([A-Z][A-Za-z0-9_]*)|([a-zA-Z_][\w]*)|([{}()[\];,.=])/g;

  let last = 0;
  let match = token.exec(line);
  let key = 0;

  while (match) {
    if (match.index > last) {
      parts.push(
        <span className="text-redop-ink/75" key={`t-${key++}`}>
          {line.slice(last, match.index)}
        </span>
      );
    }

    if (match[1]) {
      parts.push(
        <span className="text-redop-primary" key={`t-${key++}`}>
          {match[1]}
        </span>
      );
    } else if (match[2]) {
      parts.push(
        <span className="text-sky-600 dark:text-sky-400" key={`t-${key++}`}>
          {match[2]}
        </span>
      );
    } else if (match[3]) {
      parts.push(
        <span className="text-violet-600 dark:text-violet-400" key={`t-${key++}`}>
          {match[3]}
        </span>
      );
    } else if (match[4]) {
      parts.push(
        <span className="text-redop-ink" key={`t-${key++}`}>
          {match[4]}
        </span>
      );
    } else if (match[5]) {
      parts.push(
        <span className="text-redop-ink/90" key={`t-${key++}`}>
          {match[5]}
        </span>
      );
    } else if (match[6]) {
      parts.push(
        <span className="text-redop-ink/45" key={`t-${key++}`}>
          {match[6]}
        </span>
      );
    }

    last = match.index + match[0].length;
    match = token.exec(line);
  }

  if (last < line.length) {
    parts.push(
      <span className="text-redop-ink/75" key={`t-${key++}`}>
        {line.slice(last)}
      </span>
    );
  }

  return parts;
}

function RuntimeIcon({
  example,
  theme,
}: {
  example: RuntimeExample;
  theme: "light" | "dark";
}) {
  const src =
    theme === "dark" && example.iconDark ? example.iconDark : example.icon;

  return (
    <Image
      alt=""
      aria-hidden
      className="size-3.5 shrink-0 object-contain"
      height={14}
      src={src}
      unoptimized
      width={14}
    />
  );
}

export function RuntimeCode() {
  const { theme } = useTheme();
  const [activeId, setActiveId] = useState<RuntimeId>("bun");
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [copied, setCopied] = useState(false);

  const active =
    EXAMPLES.find((example) => example.id === activeId) ?? EXAMPLES[0]!;
  const lines = active.code.split("\n");

  useEffect(() => {
    if (paused) {
      return;
    }

    const timer = window.setInterval(() => {
      setVisible(false);
      window.setTimeout(() => {
        setActiveId((current) => {
          const index = EXAMPLES.findIndex((example) => example.id === current);
          const next = EXAMPLES[(index + 1) % EXAMPLES.length]!;
          return next.id;
        });
        setVisible(true);
      }, 180);
    }, 5200);

    return () => window.clearInterval(timer);
  }, [paused]);

  const selectRuntime = (id: RuntimeId) => {
    setPaused(true);
    setVisible(false);
    window.setTimeout(() => {
      setActiveId(id);
      setVisible(true);
    }, 140);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(active.code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div
      className="overflow-hidden rounded-xl border border-redop-border bg-redop-panel"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="flex items-center gap-1 border-redop-border border-b px-2 py-2 sm:px-3">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {EXAMPLES.map((example) => {
            const selected = example.id === active.id;
            return (
              <button
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 font-normal text-xs transition-colors",
                  selected
                    ? "bg-redop-ink/[0.08] text-redop-ink dark:bg-white/10"
                    : "text-redop-ink/45 hover:bg-redop-ink/[0.04] hover:text-redop-ink/75 dark:hover:bg-white/[0.04]"
                )}
                key={example.id}
                onClick={() => selectRuntime(example.id)}
                type="button"
              >
                <RuntimeIcon example={example} theme={theme} />
                <span>{example.label}</span>
              </button>
            );
          })}
        </div>

        <button
          aria-label="Copy code"
          className="ml-2 inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-redop-border text-redop-ink/55 transition-colors hover:bg-redop-ink/[0.04] hover:text-redop-ink"
          onClick={handleCopy}
          type="button"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      </div>

      <div className="relative">
        <div className="flex items-center justify-between border-redop-border border-b px-4 py-2">
          <span className="font-mono text-[11px] text-redop-ink/40">
            {active.filename}
          </span>
        </div>

        <pre
          className={cn(
            "overflow-x-auto p-4 font-mono text-[12.5px] leading-6 transition-all duration-200 sm:p-5 sm:text-[13px]",
            visible ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
          )}
        >
          <code>
            {lines.map((line, index) => (
              <div className="flex gap-4" key={`${active.id}-${index}`}>
                <span className="w-6 shrink-0 select-none text-right text-redop-ink/28">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0 whitespace-pre">
                  {highlightLine(line)}
                </span>
              </div>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}
