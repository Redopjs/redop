// ─────────────────────────────────────────────
//  redop — zod example
//  Shows full type inference from Zod schemas.
//  Run: bun run examples/with-zod.ts
// ─────────────────────────────────────────────

import { z } from "zod";

import { logger, Redop } from "../src/index";

// ── Simulated DB ──────────────────────────────

const posts = [
  {
    body: "Building MCP servers is fun",
    id: "1",
    tags: ["mcp", "bun"],
    title: "Hello redop",
  },
  {
    body: "Full inference with zero overhead",
    id: "2",
    tags: ["typescript"],
    title: "Zod schemas",
  },
];

// ── App ───────────────────────────────────────

new Redop({
  name: "with-zod",
  title: "With Zod",
  description: "With zod description",
  version: "1.0.1",
  icons: [
    {
      src: "https://media.useagents.site/useagents/icon.svg",
      mimeType: "image/svg+xml",
    },
  ],
  websiteUrl: "https://useagents.site/docs",
})

  .use(logger({ level: "info" }))
  // .use(
  //   apiKey({
  //     key: process.env.API_SECRET ?? "dev-secret",
  //   })
  // )

  // Inject timing on every request
  .onBeforeHandle(({ ctx }) => {
    (ctx as Record<string, unknown>).startedAt = performance.now();
  })
  .onAfterHandle(({ tool, ctx }) => {
    const startedAt = (ctx as Record<string, unknown>).startedAt as
      | number
      | undefined;
    const ms =
      startedAt == null ? 0 : +(performance.now() - startedAt).toFixed(2);
    console.log(`[global.after] ${tool} finished in ${ms}ms`);
  })

  // ── Post tools ────────────────────────────────

  .tool("list_posts", {
    description: "List all blog posts with optional tag filter",
    input: z.object({
      limit: z.number().int().min(1).max(100).default(10),
      tag: z.string().optional(),
    }),
    // ↓ handler input is fully typed: { tag: string | undefined, limit: number }
    handler: ({ input }) => {
      const { tag } = input;
      const filtered = tag ? posts.filter((p) => p.tags.includes(tag)) : posts;
      return { posts: filtered.slice(0, input.limit), total: filtered.length };
    },
  })

  .tool("get_post", {
    description: "Get a single post by ID",
    handler: ({ input }) => {
      const post = posts.find((p) => p.id === input.id);
      if (!post) {
        throw new Error(`Post not found: ${input.id}`);
      }
      return post;
    },
    input: z.object({
      id: z.string().min(1),
    }),
  })

  .tool("create_post", {
    description: "Create a new blog post",
    annotations: { destructiveHint: false },
    input: z.object({
      body: z.string().min(10),
      tags: z.array(z.string().max(30)).max(10).default([]),
      title: z.string().min(3).max(200),
    }),
    // handler receives { input, ctx, request, tool }
    handler: ({ input, request }) => {
      const post = {
        body: input.body,
        id: crypto.randomUUID().slice(0, 8),
        tags: input.tags,
        title: input.title,
      };
      posts.push(post);
      return { created: post, sourceIp: request.ip ?? "unknown" };
    },
    after: ({ result }) => {
      console.log(
        `[tool.after] created post ${result.created.id} from ${result.sourceIp}`
      );
    },
  })

  .tool("search_posts", {
    description: "Full-text search across post titles and bodies",
    handler: ({ input }) => {
      const q = input.query.toLowerCase();
      const results = posts.filter((p) => {
        if (input.field === "title") {
          return p.title.toLowerCase().includes(q);
        }
        if (input.field === "body") {
          return p.body.toLowerCase().includes(q);
        }
        return (
          p.title.toLowerCase().includes(q) || p.body.toLowerCase().includes(q)
        );
      });
      return { results, query: input.query, count: results.length };
    },
    input: z.object({
      query: z.string().min(1),
      field: z.enum(["title", "body", "all"]).default("all"),
    }),
  })

  .listen({
    cors: true,
    onListen: ({ url }) => {
      console.log(`redop (zod example) → ${url}`);
    },
    port: process.env.PORT ?? 3000,
  });
