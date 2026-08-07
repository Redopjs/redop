"use client";

import { Check, Copy } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type RuntimeId = "bun" | "cloudflare" | "vercel" | "node";

type RuntimeExample = {
  id: RuntimeId;
  label: string;
  filename: string;
  lines: string[];
};

const EXAMPLES: RuntimeExample[] = [
  {
    id: "bun",
    label: "Bun",
    filename: "index.ts",
    lines: [
      'import { Redop } from "@redopjs/redop";',
      "",
      "new Redop({",
      '  serverInfo: { name: "demo", version: "0.1.0" },',
      "})",
      '  .tool("ping", {',
      "    handler: async () => ({ ok: true }),",
      "  })",
      "  .listen(3000);",
    ],
  },
  {
    id: "cloudflare",
    label: "Cloudflare",
    filename: "worker.ts",
    lines: [
      'import { Redop } from "@redopjs/redop";',
      'import { toCloudflare } from "@redopjs/redop/cloudflare";',
      "",
      "const app = new Redop({",
      '  serverInfo: { name: "demo", version: "0.1.0" },',
      '}).tool("ping", { handler: async () => ({ ok: true }) });',
      "",
      "export default toCloudflare(app);",
    ],
  },
  {
    id: "vercel",
    label: "Vercel",
    filename: "api/index.ts",
    lines: [
      'import { Redop } from "@redopjs/redop";',
      'import { toVercel } from "@redopjs/redop/vercel";',
      'import { waitUntil } from "@vercel/functions";',
      "",
      "const app = new Redop({",
      '  serverInfo: { name: "demo", version: "0.1.0" },',
      '}).tool("ping", { handler: async () => ({ ok: true }) });',
      "",
      "export default toVercel(app, { waitUntil });",
    ],
  },
  {
    id: "node",
    label: "Node",
    filename: "server.ts",
    lines: [
      'import { Redop } from "@redopjs/redop";',
      'import { listenNode } from "@redopjs/redop/node";',
      "",
      "const app = new Redop({",
      '  serverInfo: { name: "demo", version: "0.1.0" },',
      '}).tool("ping", { handler: async () => ({ ok: true }) });',
      "",
      "listenNode(app, { port: 3000, hostname: \"0.0.0.0\" });",
    ],
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
        <span className="text-redop-ink/80" key={`t-${key++}`}>
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
        <span className="text-redop-ink/50" key={`t-${key++}`}>
          {match[6]}
        </span>
      );
    }

    last = match.index + match[0].length;
    match = token.exec(line);
  }

  if (last < line.length) {
    parts.push(
      <span className="text-redop-ink/80" key={`t-${key++}`}>
        {line.slice(last)}
      </span>
    );
  }

  return parts;
}

export function RuntimeCode() {
  const [activeId, setActiveId] = useState<RuntimeId>("bun");
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [copied, setCopied] = useState(false);

  const active =
    EXAMPLES.find((example) => example.id === activeId) ?? EXAMPLES[0]!;

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
    }, 4200);

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
    await navigator.clipboard.writeText(active.lines.join("\n"));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div
      className="overflow-hidden rounded-xl border border-redop-border bg-redop-panel"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="flex items-center gap-1 overflow-x-auto border-redop-border border-b px-2 pt-2 sm:px-3">
        {EXAMPLES.map((example) => {
          const selected = example.id === active.id;
          return (
            <button
              className={cn(
                "relative shrink-0 rounded-t-md px-3 py-2 font-mono text-xs transition-colors sm:text-sm",
                selected
                  ? "text-redop-ink"
                  : "text-redop-ink/45 hover:text-redop-ink/75"
              )}
              key={example.id}
              onClick={() => selectRuntime(example.id)}
              type="button"
            >
              {example.label}
              {selected ? (
                <span className="absolute inset-x-2 -bottom-px h-px bg-redop-primary" />
              ) : null}
            </button>
          );
        })}
        <div className="ml-auto hidden px-2 font-mono text-[11px] text-redop-ink/40 sm:block">
          {active.filename}
        </div>
      </div>

      <div className="relative">
        <pre
          className={cn(
            "overflow-x-auto p-4 font-mono text-[12px] leading-6 transition-all duration-200 sm:p-5 sm:text-[13px]",
            visible
              ? "translate-y-0 opacity-100"
              : "translate-y-1 opacity-0"
          )}
        >
          <code>
            {active.lines.map((line, index) => (
              <div className="flex gap-4" key={`${active.id}-${index}`}>
                <span className="w-6 shrink-0 select-none text-right text-redop-ink/30">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0 whitespace-pre">
                  {highlightLine(line)}
                </span>
              </div>
            ))}
          </code>
        </pre>

        <Button
          aria-label="Copy code"
          className="absolute right-3 bottom-3 size-8 rounded-md border border-redop-border bg-redop-warm/80 text-redop-ink/70 backdrop-blur-sm hover:bg-redop-soft hover:text-redop-ink"
          onClick={handleCopy}
          size="icon"
          type="button"
          variant="ghost"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
      </div>
    </div>
  );
}
