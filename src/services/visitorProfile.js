/**
 * Visitor Profile Store
 * 存储每位访客的个人配置（如飞书账号 ID）
 * 持久化到 data/profiles.json
 */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

/** @type {Map<string, object>} visitorId → profile */
const store = new Map();

let profilesPath = null;
let saveTimer = null;
let persisting = false;
let pendingAfterPersist = false;

/**
 * 从磁盘加载 profiles（服务启动时调用）
 * @param {string} path
 */
export async function load(path) {
  profilesPath = path;
  if (!existsSync(path)) return;

  try {
    const raw = await readFile(path, 'utf8');
    const data = JSON.parse(raw);
    for (const [visitorId, profile] of Object.entries(data)) {
      store.set(visitorId, profile);
    }
    console.log(`[profiles] Loaded ${store.size} visitor profiles.`);
  } catch (err) {
    console.error('[profiles] Failed to load profiles:', err.message);
  }
}

/**
 * 获取访客 profile
 * @param {string} visitorId
 * @returns {{ feishuAccountId?: string }}
 */
export function get(visitorId) {
  return store.get(visitorId) ?? {};
}

/**
 * 更新访客 profile（浅合并）
 * @param {string} visitorId
 * @param {object} updates
 */
export function update(visitorId, updates) {
  const existing = store.get(visitorId) ?? {};
  store.set(visitorId, { ...existing, ...updates });
  scheduleSave();
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persist().catch((err) => console.error('[profiles] Failed to save profiles:', err.message));
  }, 100);
}

async function persist() {
  if (!profilesPath) return;
  if (persisting) {
    pendingAfterPersist = true;
    return;
  }
  persisting = true;
  try {
    const data = Object.fromEntries(store);
    const json = JSON.stringify(data, null, 2);
    const tmp = `${profilesPath}.tmp`;
    await mkdir(dirname(profilesPath), { recursive: true });
    await writeFile(tmp, json, 'utf8');
    await rename(tmp, profilesPath);
  } finally {
    persisting = false;
    if (pendingAfterPersist) {
      pendingAfterPersist = false;
      persist().catch((err) => console.error('[profiles] Failed to save profiles:', err.message));
    }
  }
}
