const ASSET_FINGERPRINT = "__ASSET_FINGERPRINT__";
const DESCRIPTOR_SCHEMA = __DESCRIPTOR_SCHEMA__;
const CACHE_PREFIX = "calyx-__CHANNEL_PREFIX__payload-";
let payloadId = null;
const clientState = new Map();

const hex = (buffer) => [...new Uint8Array(buffer)]
  .map((byte) => byte.toString(16).padStart(2, "0")).join("");
const sha256 = async (bytes) => hex(await crypto.subtle.digest("SHA-256", bytes));
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};
const postAll = async (message) => {
  for (const client of await clients.matchAll({type: "window", includeUncontrolled: true})) client.postMessage(message);
};

async function validatedDescriptor() {
  const response = await fetch(`./release.json?candidate=${ASSET_FINGERPRINT}`, {cache: "reload"});
  if (!response.ok) throw new Error(`release descriptor HTTP ${response.status}`);
  const descriptor = await response.clone().json();
  if (descriptor.schema !== DESCRIPTOR_SCHEMA) throw new Error("unsupported descriptor schema");
  const ordinary = descriptor.files.filter((entry) => entry.path !== "sw.js");
  if (await sha256(new TextEncoder().encode(canonical(ordinary))) !== ASSET_FINGERPRINT ||
      descriptor.asset_fingerprint !== ASSET_FINGERPRINT) throw new Error("asset fingerprint mismatch");
  if (await sha256(new TextEncoder().encode(canonical(descriptor.files))) !== descriptor.payload_id) throw new Error("payload identity mismatch");
  return {descriptor, response};
}

self.addEventListener("install", (event) => event.waitUntil((async () => {
  let cacheName = null;
  try {
    const {descriptor, response} = await validatedDescriptor();
    payloadId = descriptor.payload_id;
    cacheName = `${CACHE_PREFIX}${payloadId}`;
    const cache = await caches.open(cacheName);
    for (const entry of descriptor.files) {
      const asset = await fetch(`./${entry.path}?candidate=${ASSET_FINGERPRINT}`, {cache: "reload"});
      if (!asset.ok) throw new Error(`${entry.path}: HTTP ${asset.status}`);
      const bytes = await asset.clone().arrayBuffer();
      if (bytes.byteLength !== entry.bytes || await sha256(bytes) !== entry.sha256) throw new Error(`${entry.path}: digest mismatch`);
      await cache.put(`./${entry.path}`, asset);
    }
    await cache.put("./release.json", response);
    await postAll({type: self.registration.active ? "UPDATE_READY" : "PRECACHE_READY", payloadId});
  } catch (error) {
    if (cacheName) await caches.delete(cacheName);
    throw error;
  }
})()));

async function ownCache() {
  if (payloadId) return `${CACHE_PREFIX}${payloadId}`;
  for (const name of await caches.keys()) {
    if (!name.startsWith(CACHE_PREFIX)) continue;
    const descriptor = await (await caches.open(name)).match("./release.json");
    if (descriptor && (await descriptor.clone().json()).asset_fingerprint === ASSET_FINGERPRINT) {
      payloadId = name.slice(CACHE_PREFIX.length);
      return name;
    }
  }
  return null;
}

self.addEventListener("activate", (event) => event.waitUntil((async () => {
  const current = await ownCache();
  if (!current) throw new Error("activated without validated cache");
  await Promise.all((await caches.keys()).filter((name) => name.startsWith(CACHE_PREFIX) && name !== current).map((name) => caches.delete(name)));
  await clients.claim();
  await postAll({type: "PRECACHE_READY", payloadId});
})()));

self.addEventListener("message", (event) => {
  const message = event.data || {};
  if (message.type === "CLIENT_STATE" && event.source?.id) clientState.set(event.source.id, Boolean(message.atLauncher));
  if (message.type === "GET_STATUS") event.waitUntil(ownCache().then((name) => event.source?.postMessage({type: "PRECACHE_READY", payloadId: name?.slice(CACHE_PREFIX.length)})));
  if (message.type === "ACTIVATE_UPDATE") event.waitUntil((async () => {
    const windows = await clients.matchAll({type: "window", includeUncontrolled: true});
    if (windows.every((client) => clientState.get(client.id) === true)) await self.skipWaiting();
    else await postAll({type: "UPDATE_BLOCKED", payloadId});
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== location.origin) return;
  event.respondWith((async () => {
    const name = await ownCache();
    const cache = name && await caches.open(name);
    const cached = cache && await cache.match(event.request);
    if (cached) return cached;
    if (event.request.mode === "navigate") return (cache && await cache.match("./index.html")) || fetch(event.request);
    return fetch(event.request);
  })());
});
