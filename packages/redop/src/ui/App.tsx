import { Check, ChevronDown, Copy, FileText } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import * as ReactDOM from "react-dom/client";
import { Toaster, toast } from "sonner";
import type {
  ResolvedPrompt,
  ResolvedResource,
  ResolvedTool,
  ServerInfoOptions,
} from "../types";
import { ClaudeAI, Cursor, GoogleAntigravity, OpenAI, Windsurf } from "./icons";

// ── Types ─────────────────────────────────────────────────────────────────

interface DevData {
  capabilities: {
    prompts: boolean;
    resources: boolean;
    tools: boolean;
  };
  mcpPath: string;
  prompts: ResolvedPrompt[];
  resources: ResolvedResource[];
  serverInfo: Required<ServerInfoOptions>;
  tools: ResolvedTool[];
}

type PageTab = "connect" | "home";
type SectionTab = "prompts" | "resources" | "tools";
type OpenCards = Record<SectionTab, string | null>;

interface SchemaField {
  defaultValue?: string;
  description?: string;
  name: string;
  required: boolean;
  type: string;
}

interface ClientOption {
  Icon: (props: React.SVGProps<SVGSVGElement>) => React.JSX.Element;
  id: string;
  label: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return String(value);
  }
  return JSON.stringify(value);
}

function toServerKey(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  return normalized.replace(/^-+|-+$/g, "") || "redop";
}

function describeSchemaType(schema: Record<string, unknown>): string {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return `enum: ${schema.enum.map((item) => formatValue(item)).join(", ")}`;
  }

  if (schema.const !== undefined) {
    return `const: ${formatValue(schema.const)}`;
  }

  if (Array.isArray(schema.type) && schema.type.length > 0) {
    return schema.type.join(" | ");
  }

  if (typeof schema.type === "string") {
    if (schema.type === "array") {
      const items = asRecord(schema.items);
      return items ? `${describeSchemaType(items)}[]` : "array";
    }
    return schema.type;
  }

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return schema.oneOf
      .map((item) => describeSchemaType(asRecord(item) ?? {}))
      .join(" | ");
  }

  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return schema.anyOf
      .map((item) => describeSchemaType(asRecord(item) ?? {}))
      .join(" | ");
  }

  if (schema.properties) {
    return "object";
  }

  return "unknown";
}

function extractSchemaFields(schema: Record<string, unknown>): SchemaField[] {
  if (schema.type !== "object") {
    return [];
  }

  const properties = asRecord(schema.properties);
  if (!properties) {
    return [];
  }

  const requiredFields = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter(
          (value): value is string => typeof value === "string"
        )
      : []
  );

  return Object.entries(properties).map(([name, rawValue]) => {
    const property = asRecord(rawValue) ?? {};
    return {
      defaultValue:
        property.default === undefined
          ? undefined
          : formatValue(property.default),
      description:
        typeof property.description === "string"
          ? property.description
          : undefined,
      name,
      required: requiredFields.has(name),
      type: describeSchemaType(property),
    };
  });
}

function DetailList({
  items,
}: {
  items: Array<{ label: string; value: React.ReactNode }>;
}) {
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div
          className="rounded-xl border border-border bg-muted/35 px-4 py-3"
          key={item.label}
        >
          <p className="font-mono text-[11px] text-muted-foreground uppercase tracking-[0.18em]">
            {item.label}
          </p>
          <div className="mt-1 break-words text-foreground text-sm">
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function Badge({
  children,
  variant = "gray",
}: {
  children: React.ReactNode;
  variant?: "amber" | "blue" | "gray" | "green" | "purple";
}) {
  const variants = {
    amber: "border-amber-500/20 bg-amber-500/10 text-amber-500",
    blue: "border-blue-500/20 bg-blue-500/10 text-blue-500",
    gray: "border-border bg-muted text-muted-foreground",
    green: "border-green-500/20 bg-green-500/10 text-green-500",
    purple: "border-purple-500/20 bg-purple-500/10 text-purple-500",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 font-medium text-xs",
        variants[variant]
      )}
    >
      {children}
    </span>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-3 rounded-xl border border-muted-foreground/25 bg-card p-4">
      <p className="font-mono text-muted-foreground text-sm uppercase tracking-wider">
        {label}
      </p>
      <p className="font-medium text-3xl">{value}</p>
    </div>
  );
}

function FieldList({
  fields,
  raw,
  rawLabel,
}: {
  fields: SchemaField[];
  raw?: Record<string, unknown>;
  rawLabel: string;
}) {
  if (fields.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm">
          This item uses a more complex shape, so the raw{" "}
          {rawLabel.toLowerCase()} is shown below.
        </p>
        {raw && (
          <pre className="overflow-x-auto rounded-lg border border-border bg-muted/60 p-4 text-muted-foreground text-xs">
            {JSON.stringify(raw, null, 2)}
          </pre>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {fields.map((field) => (
        <div
          className="rounded-lg border border-border bg-muted/35 px-4 py-3"
          key={field.name}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <p className="font-mono text-foreground text-sm">
                  {field.name}
                </p>
                <Badge variant={field.required ? "amber" : "gray"}>
                  {field.required ? "required" : "optional"}
                </Badge>
              </div>
              {field.description && (
                <p className="mt-1 text-muted-foreground text-sm">
                  {field.description}
                </p>
              )}
            </div>
            <Badge variant="blue">{field.type}</Badge>
          </div>
          {field.defaultValue && (
            <p className="mt-3 text-muted-foreground text-xs">
              Default:{" "}
              <span className="font-mono text-foreground">
                {field.defaultValue}
              </span>
            </p>
          )}
        </div>
      ))}

      {raw && (
        <details className="rounded-xl border border-border bg-muted/25 px-4 py-3">
          <summary className="cursor-pointer font-medium text-foreground text-sm">
            View raw {rawLabel.toLowerCase()}
          </summary>
          <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-muted/60 p-3 text-muted-foreground text-xs">
            {JSON.stringify(raw, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

function ExpandableCard({
  badges,
  children,
  description,
  open,
  onToggle,
  subtitle,
  title,
}: {
  badges?: React.ReactNode;
  children: React.ReactNode;
  description?: string;
  onToggle: () => void;
  open: boolean;
  subtitle?: string;
  title: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border bg-card transition-all duration-200",
        open
          ? "border-primary/30"
          : "border-muted-foreground/25 hover:border-primary/30"
      )}
    >
      <button
        className="flex w-full items-start justify-between gap-4 px-5 py-5 text-left"
        onClick={onToggle}
        type="button"
      >
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/55 text-muted-foreground">
            <FileText className="size-4" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium font-mono text-foreground text-sm">
                {title}
              </p>
              {subtitle && (
                <p className="truncate text-muted-foreground text-sm">
                  {subtitle}
                </p>
              )}
            </div>

            {description && (
              <p className="mt-2 text-muted-foreground text-sm leading-relaxed">
                {description}
              </p>
            )}

            {badges && (
              <div className="mt-3 flex flex-wrap gap-2">{badges}</div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 pl-2 text-muted-foreground">
          <span className="hidden font-medium text-xs sm:inline">
            {open ? "Collapse" : "Expand"}
          </span>
          <ChevronDown
            className={cn(
              "size-4 transition-transform duration-300",
              open && "rotate-180"
            )}
          />
        </div>
      </button>

      <div
        className="grid transition-[grid-template-rows,opacity] duration-300 ease-out"
        style={{
          gridTemplateRows: open ? "1fr" : "0fr",
          opacity: open ? 1 : 0,
        }}
      >
        <div className="overflow-hidden">
          <div className="border-border/70 border-t px-5 pt-4 pb-5">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolCard({
  onToggle,
  open,
  tool,
}: {
  onToggle: () => void;
  open: boolean;
  tool: ResolvedTool;
}) {
  const inputFields = extractSchemaFields(tool.inputSchema);

  return (
    <ExpandableCard
      badges={
        <>
          {tool.taskSupport && tool.taskSupport !== "forbidden" && (
            <Badge variant="blue">async: {tool.taskSupport}</Badge>
          )}
          {tool.outputSchema && (
            <Badge variant="green">structured output</Badge>
          )}
          {tool.annotations?.readOnlyHint && (
            <Badge variant="gray">read-only</Badge>
          )}
          {tool.annotations?.destructiveHint && (
            <Badge variant="amber">destructive</Badge>
          )}
        </>
      }
      description={tool.description}
      onToggle={onToggle}
      open={open}
      subtitle={tool.title}
      title={tool.name}
    >
      <div className="space-y-4">
        <div>
          <p className="mb-2 font-mono text-[11px] text-muted-foreground uppercase tracking-[0.18em]">
            Tool Input
          </p>
          <FieldList
            fields={inputFields}
            raw={tool.inputSchema}
            rawLabel="Schema"
          />
        </div>
      </div>
    </ExpandableCard>
  );
}

function ResourceCard({
  onToggle,
  open,
  resource,
}: {
  onToggle: () => void;
  open: boolean;
  resource: ResolvedResource;
}) {
  return (
    <ExpandableCard
      badges={
        <>
          <Badge variant={resource.isTemplate ? "purple" : "gray"}>
            {resource.isTemplate ? "template" : "static"}
          </Badge>
          {resource.mimeType && (
            <Badge variant="blue">{resource.mimeType}</Badge>
          )}
          {resource.subscribe && <Badge variant="green">subscribable</Badge>}
        </>
      }
      description={resource.description}
      onToggle={onToggle}
      open={open}
      subtitle={resource.uri}
      title={resource.name}
    >
      <DetailList
        items={[
          {
            label: "URI",
            value: <span className="font-mono text-sm">{resource.uri}</span>,
          },
          {
            label: "Kind",
            value: resource.isTemplate
              ? "Template resource"
              : "Static resource",
          },
          {
            label: "MIME Type",
            value: resource.mimeType ?? "Not specified",
          },
          {
            label: "Subscriptions",
            value: resource.subscribe
              ? "Clients can subscribe to change notifications."
              : "Subscription support is not enabled.",
          },
        ]}
      />
    </ExpandableCard>
  );
}

function PromptCard({
  onToggle,
  open,
  prompt,
}: {
  onToggle: () => void;
  open: boolean;
  prompt: ResolvedPrompt;
}) {
  const fields: SchemaField[] = (prompt.arguments ?? []).map((argument) => ({
    description: argument.description || undefined,
    name: argument.name,
    required: argument.required ?? false,
    type: "string",
  }));

  return (
    <ExpandableCard
      badges={
        <>
          <Badge variant="purple">
            {fields.length} {fields.length === 1 ? "arg" : "args"}
          </Badge>
        </>
      }
      description={prompt.description}
      onToggle={onToggle}
      open={open}
      subtitle={`${fields.length} ${fields.length === 1 ? "argument" : "arguments"}`}
      title={prompt.name}
    >
      <div>
        <p className="mb-2 font-mono text-[11px] text-muted-foreground uppercase tracking-[0.18em]">
          Prompt Arguments
        </p>
        <FieldList fields={fields} rawLabel="Arguments" />
      </div>
    </ExpandableCard>
  );
}

function EmptyState({ label, message }: { label: string; message: string }) {
  return (
    <div className="w-full rounded-xl border border-muted-foreground/25 border-dashed p-10 text-center">
      <p className="font-medium text-foreground">No {label} registered.</p>
      <p className="mt-2 text-muted-foreground text-sm">{message}</p>
    </div>
  );
}

function ConnectClientCard({
  client,
  onSelect,
  selected,
}: {
  client: ClientOption;
  onSelect: () => void;
  selected: boolean;
}) {
  return (
    <button
      className={cn(
        "flex items-center gap-4 rounded-xl border border-dashed px-5 py-4 text-left transition-all",
        selected
          ? "border-primary/40 bg-primary/5"
          : "border-muted-foreground/25 bg-card hover:border-primary/25 hover:bg-muted/25"
      )}
      onClick={onSelect}
      type="button"
    >
      <client.Icon className="size-8 shrink-0 text-foreground" />
      <span className="font-medium text-foreground text-lg">
        {client.label}
      </span>
    </button>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────

function App() {
  const [data, setData] = useState<DevData>();
  const [pageTab, setPageTab] = useState<PageTab>("home");
  const [activeSection, setActiveSection] = useState<SectionTab>("tools");
  const [openCards, setOpenCards] = useState<OpenCards>({
    prompts: null,
    resources: null,
    tools: null,
  });
  const [selectedClient, setSelectedClient] = useState("cursor");
  const [copyState, setCopyState] = useState<"copied" | "idle">("idle");

  useEffect(() => {
    fetch("/_debug/data")
      .then((r) => r.json())
      .then((result) => setData(result as DevData));
  }, []);

  useEffect(() => {
    if (!data) {
      return;
    }

    const serverTitle = data.serverInfo.title ?? data.serverInfo.name;
    document.title = `${serverTitle} — Redop`;

    let metaDesc = document.querySelector('meta[name="description"]');
    if (!metaDesc) {
      metaDesc = document.createElement("meta");
      metaDesc.setAttribute("name", "description");
      document.head.appendChild(metaDesc);
    }
    if (data.serverInfo.description) {
      metaDesc.setAttribute("content", data.serverInfo.description);
    }

    if (data.serverInfo.icons && data.serverInfo.icons.length > 0) {
      const [iconData] = data.serverInfo.icons;
      if (!iconData) {
        return;
      }

      let link: HTMLLinkElement | null =
        document.querySelector("link[rel~='icon']");
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = iconData.src;
      if (iconData.mimeType) {
        link.type = iconData.mimeType;
      }
    }
  }, [data]);

  useEffect(() => {
    if (copyState !== "copied") {
      return;
    }

    const timeout = window.setTimeout(() => setCopyState("idle"), 1800);
    return () => window.clearTimeout(timeout);
  }, [copyState]);

  useEffect(() => {
    if (!data) {
      return;
    }

    const orderedSections: SectionTab[] = ["tools", "resources", "prompts"];
    if (data.capabilities[activeSection]) {
      return;
    }

    const fallback = orderedSections.find(
      (section) => data.capabilities[section]
    );
    if (fallback) {
      setActiveSection(fallback);
    }
  }, [activeSection, data]);

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Loading redop...
      </div>
    );
  }

  const serverTitle = data.serverInfo.title ?? data.serverInfo.name;
  const serverKey = toServerKey(data.serverInfo.name);
  const mcpUrl = new URL(data.mcpPath, window.location.origin).toString();
  const genericConfig = JSON.stringify(
    {
      mcpServers: {
        [serverKey]: {
          url: mcpUrl,
        },
      },
    },
    null,
    2
  );

  const connectClients: ClientOption[] = [
    { Icon: Cursor, id: "cursor", label: "Cursor" },
    { Icon: ClaudeAI, id: "claude-code", label: "Claude Code" },
    { Icon: ClaudeAI, id: "claude-desktop", label: "Claude Desktop" },
    { Icon: Windsurf, id: "windsurf", label: "Windsurf" },
    { Icon: GoogleAntigravity, id: "gemini-cli", label: "Gemini CLI" },
    { Icon: OpenAI, id: "codex", label: "Codex" },
  ];

  const sectionItems = {
    prompts: data.prompts,
    resources: data.resources,
    tools: data.tools,
  } as const;
  const sectionTabs = ["tools", "resources", "prompts"] as const;
  const sectionDescriptions: Record<SectionTab, string> = {
    prompts: "Prompt support is disabled for this server.",
    resources: "Resource support is disabled for this server.",
    tools: "Tool support is disabled for this server.",
  };

  const toggleCard = (section: SectionTab, cardId: string) => {
    setOpenCards((current) => ({
      ...current,
      [section]: current[section] === cardId ? null : cardId,
    }));
  };

  const copyMcpUrl = async () => {
    try {
      await navigator.clipboard.writeText(mcpUrl);
      setCopyState("copied");
      toast.success("MCP URL copied to clipboard");
    } catch {
      setCopyState("idle");
      toast.error("Could not copy the MCP URL");
    }
  };

  const copyClientConnection = async (client: ClientOption) => {
    setSelectedClient(client.id);

    try {
      await navigator.clipboard.writeText(mcpUrl);
      toast.success(`${client.label} connection copied to clipboard`);
    } catch {
      toast.error(`Could not copy the ${client.label} connection`);
    }
  };

  const copyGenericConfig = async () => {
    try {
      await navigator.clipboard.writeText(genericConfig);
      toast.success("Connection config copied to clipboard");
    } catch {
      toast.error("Could not copy the connection config");
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-8 pb-8">
      <Toaster position="top-center" richColors />

      <nav className="flex items-center justify-between gap-4 rounded-2xl py-4">
        <div className="flex min-w-0 items-center gap-3">
          {data.serverInfo.icons?.[0] ? (
            <img
              alt="Logo"
              className="size-10 rounded-lg bg-card object-contain"
              src={data.serverInfo.icons[0].src}
            />
          ) : (
            <div className="flex size-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 font-bold text-primary text-sm">
              {serverTitle.charAt(0)}
            </div>
          )}

          <div className="min-w-0">
            <p className="truncate font-medium text-foreground text-sm">
              {serverTitle}
            </p>
            <p className="text-[11px] text-muted-foreground/60 uppercase tracking-widest">
              Dev Environment
            </p>
          </div>
        </div>

        <div className="inline-flex shrink-0 rounded-md bg-muted p-1">
          {[
            { label: "Home", value: "home" as const },
            { label: "Connect", value: "connect" as const },
          ].map((tab) => (
            <button
              className={cn(
                "inline-flex items-center rounded-md px-3 py-1.5 font-medium text-xs transition-colors",
                pageTab === tab.value
                  ? "border border-border bg-white text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
              key={tab.value}
              onClick={() => setPageTab(tab.value)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {pageTab === "home" ? (
        <>
          <header className="flex items-start gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-medium text-2xl tracking-tight">
                  {serverTitle}
                </h1>
                <Badge variant="gray">v{data.serverInfo.version}</Badge>
                <Badge variant="blue">MCP 2025-11-25</Badge>
              </div>
              {data.serverInfo.description && (
                <p className="mt-1 max-w-2xl text-muted-foreground">
                  {data.serverInfo.description}
                </p>
              )}
              {data.serverInfo.websiteUrl && (
                <a
                  className="mt-2 inline-block text-primary text-xs hover:underline"
                  href={data.serverInfo.websiteUrl}
                  rel="noopener"
                  target="_blank"
                >
                  {data.serverInfo.websiteUrl.replace(/^https?:\/\//, "")}
                </a>
              )}
            </div>
          </header>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              label={
                data.capabilities.tools ? "Registered Tools" : "Tools Disabled"
              }
              value={data.capabilities.tools ? data.tools.length : 0}
            />
            <StatCard
              label={
                data.capabilities.resources ? "Resources" : "Resources Disabled"
              }
              value={data.capabilities.resources ? data.resources.length : 0}
            />
            <StatCard
              label={data.capabilities.prompts ? "Prompts" : "Prompts Disabled"}
              value={data.capabilities.prompts ? data.prompts.length : 0}
            />
          </div>

          <section>
            <div className="mb-6 flex gap-3 border-border border-b">
              {sectionTabs.map((tab) => {
                const enabled = data.capabilities[tab];

                return (
                  <button
                    className={cn(
                      "relative pb-3 font-medium text-sm capitalize transition-colors",
                      !enabled && "cursor-not-allowed text-muted-foreground/45",
                      enabled &&
                        (activeSection === tab
                          ? "text-foreground"
                          : "text-muted-foreground hover:text-foreground")
                    )}
                    disabled={!enabled}
                    key={tab}
                    onClick={() => setActiveSection(tab)}
                    type="button"
                  >
                    {tab}{" "}
                    <span className="text-muted-foreground">
                      ({enabled ? sectionItems[tab].length : 0})
                    </span>
                    {!enabled && (
                      <span className="ml-2 text-[11px] text-muted-foreground/50 uppercase tracking-wide">
                        disabled
                      </span>
                    )}
                    {enabled && activeSection === tab && (
                      <span className="absolute bottom-0 left-0 h-0.5 w-full rounded-t-full bg-primary" />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="space-y-4">
              {!data.capabilities[activeSection] && (
                <EmptyState
                  label={activeSection}
                  message={sectionDescriptions[activeSection]}
                />
              )}
              {activeSection === "tools" &&
                data.capabilities.tools &&
                data.tools.length === 0 && (
                  <EmptyState
                    label="tools"
                    message="Add a tool to inspect schema, execution hints, and input details here."
                  />
                )}
              {activeSection === "tools" &&
                data.capabilities.tools &&
                data.tools.map((tool) => (
                  <ToolCard
                    key={tool.name}
                    onToggle={() => toggleCard("tools", tool.name)}
                    open={openCards.tools === tool.name}
                    tool={tool}
                  />
                ))}

              {activeSection === "resources" &&
                data.capabilities.resources &&
                data.resources.length === 0 && (
                  <EmptyState
                    label="resources"
                    message="Registered resources will appear here with readable metadata and template details."
                  />
                )}
              {activeSection === "resources" &&
                data.capabilities.resources &&
                data.resources.map((resource) => (
                  <ResourceCard
                    key={resource.uri}
                    onToggle={() => toggleCard("resources", resource.uri)}
                    open={openCards.resources === resource.uri}
                    resource={resource}
                  />
                ))}

              {activeSection === "prompts" &&
                data.capabilities.prompts &&
                data.prompts.length === 0 && (
                  <EmptyState
                    label="prompts"
                    message="Registered prompts will appear here with readable argument details."
                  />
                )}
              {activeSection === "prompts" &&
                data.capabilities.prompts &&
                data.prompts.map((prompt) => (
                  <PromptCard
                    key={prompt.name}
                    onToggle={() => toggleCard("prompts", prompt.name)}
                    open={openCards.prompts === prompt.name}
                    prompt={prompt}
                  />
                ))}
            </div>
          </section>
        </>
      ) : (
        <section className="space-y-8">
          <div className="space-y-2">
            <h1 className="font-medium text-2xl text-foreground tracking-tight">
              Connect to {serverTitle}
            </h1>
            <p className="text-lg text-muted-foreground">
              Select your preferred way to connect to this MCP server.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <h2 className="font-medium text-foreground text-xl tracking-tight">
                Connect to a client
              </h2>
              <p className="mt-2 text-muted-foreground">
                Choose the client you want to use. The MCP URL below always
                points to the current server you are previewing.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {connectClients.map((client) => (
                <ConnectClientCard
                  client={client}
                  key={client.id}
                  onSelect={() => void copyClientConnection(client)}
                  selected={selectedClient === client.id}
                />
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-muted-foreground">
              For clients not listed above, use the MCP URL below.
            </p>

            <div className="rounded-2xl border border-border bg-card">
              <div className="flex items-center justify-between border-border border-b px-4 py-3">
                <div>
                  <p className="font-medium text-foreground text-sm">
                    Generic MCP config
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Use this for clients that accept a JSON MCP config
                  </p>
                </div>

                <button
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 font-medium text-foreground text-sm transition-colors hover:bg-muted/70"
                  onClick={copyGenericConfig}
                  type="button"
                >
                  <Copy className="size-4" />
                  Copy config
                </button>
              </div>

              <div className="px-4 py-4">
                <pre className="overflow-x-auto rounded-xl border border-border bg-muted/45 p-4 font-mono text-foreground text-sm">
                  {genericConfig}
                </pre>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-2xl border border-border bg-card px-4 py-3">
              <div>
                <p className="font-medium text-foreground text-sm">
                  Current MCP URL
                </p>
                <p className="text-muted-foreground text-xs">
                  Direct URL for this running server
                </p>
              </div>

              <button
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 font-medium text-foreground text-sm transition-colors hover:bg-muted/70"
                onClick={copyMcpUrl}
                type="button"
              >
                {copyState === "copied" ? (
                  <Check className="size-4 text-green-500" />
                ) : (
                  <Copy className="size-4" />
                )}
                {copyState === "copied" ? "Copied" : "Copy MCP URL"}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(<App />);
