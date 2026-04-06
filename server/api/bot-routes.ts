/**
 * RoboBot & Knowledge Space — REST API routes
 *
 * 挂载为 /api/bots/* 和 /api/knowledge-spaces/*
 */

import { Router } from "express";
import { BotStore } from "../rdkclaw/bot-store.js";
import { KnowledgeSpaceStore } from "../rdkclaw/knowledge-space-store.js";
import { chunkDocument, USER_LIBRARY_CHUNK_OPTIONS } from "../rdkclaw/knowledge-chunker.js";
import type { KnowledgeSourceUrl } from "../rdkclaw/knowledge-space-store.js";
import { randomUUID } from "node:crypto";
import {
  extractHttpsUrlsFromText,
  normalizeUrl,
  stripHtml,
  truncate,
} from "../agent/tools/web-text-utils.js";

async function ingestUrlIntoKnowledgeSpace(
  spaceId: string,
  rawUrl: string,
  titleOverride?: string,
): Promise<{ source: KnowledgeSourceUrl; chunks: ReturnType<typeof chunkDocument> }> {
  let normalizedUrl = "";
  try {
    normalizedUrl = normalizeUrl(rawUrl);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "invalid url");
  }

  const response = await fetch(normalizedUrl, {
    method: "GET",
    redirect: "follow",
    headers: {
      "User-Agent": "RDKStudio/1.0 (+knowledge-ingest)",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
    },
  });
  if (!response.ok) {
    throw new Error(`failed to fetch url: ${response.status}`);
  }

  const htmlOrText = await response.text();
  const extracted = truncate(stripHtml(htmlOrText), 60_000);
  if (!extracted.trim()) {
    throw new Error("url content is empty after extraction");
  }

  const htmlTitleMatch = htmlOrText.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const resolvedTitle = String(titleOverride ?? "").trim()
    || htmlTitleMatch?.[1]?.replace(/\s+/g, " ").trim()
    || normalizedUrl;

  const sourceId = randomUUID();
  const chunks = chunkDocument(extracted, spaceId, sourceId, {
    title: resolvedTitle,
    url: normalizedUrl,
  }, USER_LIBRARY_CHUNK_OPTIONS);

  const source: KnowledgeSourceUrl = {
    type: "url",
    id: sourceId,
    url: normalizedUrl,
    title: resolvedTitle,
  };

  return { source, chunks };
}

export function createBotApiRoutes(): Router {
  const router = Router();
  const botStore = new BotStore();
  const spaceStore = new KnowledgeSpaceStore();

  // =========================================================================
  //  RoboBot CRUD
  // =========================================================================

  /** GET /api/bots — List all bots */
  router.get("/", (_req, res) => {
    const bots = botStore.listBots();
    const activeBotId = botStore.getActiveBotId();
    res.json({ bots, activeBotId });
  });

  /** GET /api/bots/:id — Get single bot */
  router.get("/:id", (req, res) => {
    const bot = botStore.getBot(req.params.id);
    if (!bot) return res.status(404).json({ error: "Bot not found" });
    res.json(bot);
  });

  /** POST /api/bots — Create bot */
  router.post("/", (req, res) => {
    try {
      const {
        name, icon, description, persona,
        knowledgeSpaceIds, skillIds,
        includeRdkOfficialDocs, docPriority,
        visibility, tags,
      } = req.body;

      if (!name?.trim()) {
        return res.status(400).json({ error: "name is required" });
      }

      const bot = botStore.createBot({
        name: String(name).trim(),
        icon: icon || undefined,
        description: String(description ?? "").trim(),
        persona: {
          systemPromptOverride: persona?.systemPromptOverride || undefined,
          extraInstructions: persona?.extraInstructions || "",
          delegationBias: persona?.delegationBias,
          autonomyLevel: persona?.autonomyLevel,
          riskLevel: persona?.riskLevel,
        },
        knowledgeSpaceIds: knowledgeSpaceIds ?? [],
        skillIds: skillIds ?? [],
        includeRdkOfficialDocs: includeRdkOfficialDocs !== false,
        docPriority: docPriority ?? "merged",
        visibility: visibility ?? "private",
        tags: tags ?? [],
      });

      res.status(201).json(bot);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /** PATCH /api/bots/:id — Update bot */
  router.patch("/:id", (req, res) => {
    const updated = botStore.updateBot(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: "Bot not found" });
    res.json(updated);
  });

  /** DELETE /api/bots/:id — Delete bot */
  router.delete("/:id", (req, res) => {
    const deleted = botStore.deleteBot(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Bot not found" });
    res.json({ deleted: true });
  });

  /** POST /api/bots/activate — Set active bot */
  router.post("/activate", (req, res) => {
    try {
      const { botId } = req.body;
      botStore.setActiveBot(botId || undefined);
      res.json({ activeBotId: botId || null });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  return router;
}

export function createKnowledgeSpaceApiRoutes(): Router {
  const router = Router();
  const spaceStore = new KnowledgeSpaceStore();

  // =========================================================================
  //  Knowledge Space CRUD
  // =========================================================================

  /** GET /api/knowledge-spaces — List all spaces */
  router.get("/", (_req, res) => {
    const spaces = spaceStore.listSpaces();
    res.json({ spaces });
  });

  /** GET /api/knowledge-spaces/:id — Get single space */
  router.get("/:id", (req, res) => {
    const space = spaceStore.getSpace(req.params.id);
    if (!space) return res.status(404).json({ error: "Knowledge space not found" });
    res.json(space);
  });

  /** POST /api/knowledge-spaces — Create space */
  router.post("/", (req, res) => {
    try {
      const { name, description, sources } = req.body;
      if (!name?.trim()) {
        return res.status(400).json({ error: "name is required" });
      }
      const space = spaceStore.createSpace({
        name: String(name).trim(),
        description: String(description ?? "").trim(),
        sources,
      });
      res.status(201).json(space);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /** PATCH /api/knowledge-spaces/:id — Update space */
  router.patch("/:id", (req, res) => {
    const updated = spaceStore.updateSpace(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: "Knowledge space not found" });
    res.json(updated);
  });

  /** DELETE /api/knowledge-spaces/:id — Delete space */
  router.delete("/:id", (req, res) => {
    const deleted = spaceStore.deleteSpace(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Knowledge space not found" });
    res.json({ deleted: true });
  });

  /** POST /api/knowledge-spaces/:id/index-text — Index text content into a space */
  router.post("/:id/index-text", (req, res) => {
    try {
      const space = spaceStore.getSpace(req.params.id);
      if (!space) return res.status(404).json({ error: "Knowledge space not found" });

      const { title, content, url } = req.body;
      if (!content?.trim()) {
        return res.status(400).json({ error: "content is required" });
      }

      const sourceId = randomUUID();
      const chunks = chunkDocument(
        String(content),
        space.id,
        sourceId,
        { title: title || undefined, url: url || undefined },
        USER_LIBRARY_CHUNK_OPTIONS,
      );

      spaceStore.updateSpace(space.id, {
        indexStatus: "indexing",
        sources: [
          ...(space.sources ?? []),
          {
            type: "text",
            id: sourceId,
            title: String(title || "手动导入"),
            content: String(content),
          },
        ],
      });

      // 合并到现有 chunks
      const existing = spaceStore.getChunks(space.id);
      spaceStore.saveChunks(space.id, [...existing, ...chunks]);

      res.json({ indexed: chunks.length, totalChunks: existing.length + chunks.length });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /** POST /api/knowledge-spaces/:id/index-url — Fetch and index website content into a space */
  router.post("/:id/index-url", async (req, res) => {
    try {
      const space = spaceStore.getSpace(req.params.id);
      if (!space) return res.status(404).json({ error: "Knowledge space not found" });

      const rawUrl = String(req.body?.url ?? "").trim();
      if (!rawUrl) {
        return res.status(400).json({ error: "url is required" });
      }

      const title = String(req.body?.title ?? "").trim() || undefined;
      let result: Awaited<ReturnType<typeof ingestUrlIntoKnowledgeSpace>>;
      try {
        result = await ingestUrlIntoKnowledgeSpace(space.id, rawUrl, title);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes("invalid url") || msg.includes("仅支持")) {
          return res.status(400).json({ error: msg });
        }
        if (msg.includes("failed to fetch url:")) {
          return res.status(502).json({ error: msg });
        }
        if (msg.includes("empty after extraction")) {
          return res.status(422).json({ error: msg });
        }
        return res.status(500).json({ error: msg });
      }

      const { source, chunks } = result;
      spaceStore.updateSpace(space.id, {
        indexStatus: "indexing",
        sources: [...(space.sources ?? []), source],
      });

      const existing = spaceStore.getChunks(space.id);
      spaceStore.saveChunks(space.id, [...existing, ...chunks]);

      res.json({ indexed: chunks.length, totalChunks: existing.length + chunks.length });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /**
   * POST /api/knowledge-spaces/:id/index-urls-bulk
   * 批量抓取并索引（urls 数组，或 urlsText 中自动抽取 https 链接）。
   */
  router.post("/:id/index-urls-bulk", async (req, res) => {
    try {
      const space = spaceStore.getSpace(req.params.id);
      if (!space) return res.status(404).json({ error: "Knowledge space not found" });

      const urlsFromBody = req.body?.urls;
      const urlsText = String(req.body?.urlsText ?? "").trim();
      const urlList: string[] = Array.isArray(urlsFromBody) && urlsFromBody.length
        ? urlsFromBody.map((u: unknown) => String(u).trim()).filter(Boolean)
        : extractHttpsUrlsFromText(urlsText);

      if (urlList.length === 0) {
        return res.status(400).json({
          error: "Provide urls (non-empty array) or urlsText containing https links",
        });
      }

      const results: Array<{ url: string; ok: boolean; indexed?: number; error?: string }> = [];
      let sources = [...(space.sources ?? [])];
      let allChunks = [...spaceStore.getChunks(space.id)];
      let addedChunksThisRun = 0;

      for (const rawUrl of urlList) {
        try {
          const { source, chunks } = await ingestUrlIntoKnowledgeSpace(space.id, rawUrl);
          sources.push(source);
          allChunks = [...allChunks, ...chunks];
          addedChunksThisRun += chunks.length;
          results.push({ url: source.url, ok: true, indexed: chunks.length });
        } catch (e) {
          results.push({ url: rawUrl, ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      }

      spaceStore.updateSpace(space.id, {
        indexStatus: "indexing",
        sources,
      });
      spaceStore.saveChunks(space.id, allChunks);

      res.json({
        results,
        totalChunks: allChunks.length,
        indexedUrls: results.filter((r) => r.ok).length,
        /** 本次批量任务新增的摘录段数（便于与「资料库累计」区分） */
        addedChunksThisRun,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /** POST /api/knowledge-spaces/:id/search — Search within a space */
  router.post("/:id/search", (req, res) => {
    try {
      const { query, topK } = req.body;
      if (!query?.trim()) {
        return res.status(400).json({ error: "query is required" });
      }

      const results = spaceStore.search(
        String(query),
        [req.params.id],
        topK ?? 5,
      );

      res.json({
        results: results.map((r) => ({
          content: r.chunk.content,
          score: r.score,
          metadata: r.chunk.metadata,
          spaceName: r.spaceName,
        })),
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
