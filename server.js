import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

// Very small in-memory cache (name -> {expires, data})
const profileCache = new Map();
const CACHE_MS = 5 * 60 * 1000;

function now() { return Date.now(); }

async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "ShlyapCoinMiniApp/0.4" } });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function b64decode(str) {
  return Buffer.from(str, "base64").toString("utf8");
}

async function resolveProfileByName(nameRaw) {
  const name = String(nameRaw || "").trim();
  if (!name) {
    const err = new Error("Missing name");
    err.status = 400;
    throw err;
  }

  const key = name.toLowerCase();
  const cached = profileCache.get(key);
  if (cached && cached.expires > now()) return cached.data;

  // 1) Name -> UUID
  // Official endpoint: https://api.mojang.com/users/profiles/minecraft/<username>
  const prof = await fetchJson(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`);
  const uuid = prof.id;

  // 2) UUID -> session profile (textures)
  // Official endpoint: https://sessionserver.mojang.com/session/minecraft/profile/<uuid>
  const session = await fetchJson(`https://sessionserver.mojang.com/session/minecraft/profile/${encodeURIComponent(uuid)}`);

  const props = Array.isArray(session.properties) ? session.properties : [];
  const texturesProp = props.find(p => p && p.name === "textures");
  if (!texturesProp || !texturesProp.value) {
    const err = new Error("No textures property found");
    err.status = 502;
    throw err;
  }

  const decoded = JSON.parse(b64decode(texturesProp.value));
  const skinUrl = decoded?.textures?.SKIN?.url;
  const model = decoded?.textures?.SKIN?.metadata?.model === "slim" ? "slim" : "wide";

  if (!skinUrl) {
    const err = new Error("Skin URL missing");
    err.status = 502;
    throw err;
  }

  const data = {
    name: prof.name || name,
    uuid,
    model,
    // We proxy the PNG to avoid CORS issues in WebGL (skinview3d)
    skinPng: `/api/skin.png?name=${encodeURIComponent(prof.name || name)}`,
    // also provide original
    skinUrl
  };

  profileCache.set(key, { expires: now() + CACHE_MS, data });
  return data;
}

app.use(express.json({ limit: "1mb" }));

// API: profile json
app.get("/api/profile", async (req, res) => {
  try {
    const data = await resolveProfileByName(req.query.name);
    res.json({ ok: true, ...data });
  } catch (e) {
    const status = e?.status || 500;
    res.status(status).json({ ok: false, error: e?.message || "Unknown error" });
  }
});

// API: proxy skin png (same-origin)
app.get("/api/skin.png", async (req, res) => {
  try {
    const data = await resolveProfileByName(req.query.name);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const skinRes = await fetch(data.skinUrl, { signal: controller.signal, headers: { "User-Agent": "ShlyapCoinMiniApp/0.4" } });
    clearTimeout(timer);

    if (!skinRes.ok) {
      res.status(502).send("Failed to fetch skin");
      return;
    }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=300");
    // Stream
    const buf = Buffer.from(await skinRes.arrayBuffer());
    res.send(buf);
  } catch (e) {
    res.status(e?.status || 500).send(e?.message || "Error");
  }
});

// Serve static
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders(res, p) {
    if (p.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
  }
}));

// SPA fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`[miniapp] http://localhost:${PORT}`);
});
