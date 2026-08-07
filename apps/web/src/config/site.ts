const url =
  process.env.NODE_ENV === "production"
    ? "https://redop.useagents.site"
    : "http://localhost:3000";

export const siteConfig = {
  description:
    "The runtime-agnostic framework for production MCP servers. Define tools, resources, and prompts once — deploy on Bun, Node, Cloudflare, or Vercel.",
  name: "Redop",
  ogImage: `${url}/og.png`,
  tagline: "The runtime-agnostic framework for production MCP servers",
  title: "Redop | Runtime-agnostic MCP Framework",
  url,
};

export const SITE_KEYWORDS = [
  "MCP tools",
  "MCP server",
  "Model Context Protocol",
  "MCP",
  "LLM tools",
  "AI agents",
  "TypeScript",
  "Bun",
  "Cloudflare Workers",
  "Vercel",
  "Node.js",
  "runtime adapters",
  "UseAgents",
];
