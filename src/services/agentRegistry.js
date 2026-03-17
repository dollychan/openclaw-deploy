/**
 * Agent Registry
 * 维护 visitorId → agentId 的双向映射
 * - 内存中 Map 提供 O(1) 查找
 * - 写时异步持久化到 registry.json（原子写入）
 * - 服务启动时从磁盘恢复映射
 */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

/** @type {Map<string, string>} visitorId → agentId */
const registry = new Map();

/** 防止持久化竞争的 pending 标志 */
let saveTimer = null;

/**
 * 从磁盘加载 registry（服务启动时调用）
 * @param {string} registryPath - registry.json 路径
 */
export async function load(registryPath) {
  if (!existsSync(registryPath)) {
    console.log('[registry] No existing registry found, starting fresh.');
    return;
  }

  try {
    const raw = await readFile(registryPath, 'utf8');
    const data = JSON.parse(raw);

    if (data && typeof data === 'object') {
      for (const [visitorId, agentId] of Object.entries(data)) {
        registry.set(visitorId, agentId);
      }
      console.log(`[registry] Loaded ${registry.size} visitor→agent mappings.`);
    }
  } catch (err) {
    console.error('[registry] Failed to load registry, starting fresh:', err.message);
  }
}

/**
 * 获取访客对应的 agentId
 * @param {string} visitorId
 * @returns {string|null}
 */
export function get(visitorId) {
  return registry.get(visitorId) ?? null;
}

/**
 * 设置访客的 agentId 并触发持久化
 * @param {string} visitorId
 * @param {string} agentId
 * @param {string} registryPath
 */
export function set(visitorId, agentId, registryPath) {
  registry.set(visitorId, agentId);
  scheduleSave(registryPath);
}

/**
 * 检查访客是否已有 Agent
 * @param {string} visitorId
 * @returns {boolean}
 */
export function has(visitorId) {
  return registry.has(visitorId);
}

/**
 * 获取当前注册的所有条目数量
 * @returns {number}
 */
export function size() {
  return registry.size;
}

/**
 * 防抖持久化：100ms 内的多次 set 合并为一次写入
 * @param {string} registryPath
 */
function scheduleSave(registryPath) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistRegistry(registryPath).catch((err) => {
      console.error('[registry] Failed to persist registry:', err.message);
    });
  }, 100);
}

/**
 * 原子写入 registry.json
 * 先写到 .tmp 临时文件，再 rename 替换，防止中途崩溃损坏文件
 * @param {string} registryPath
 */
async function persistRegistry(registryPath) {
  const data = Object.fromEntries(registry);
  const json = JSON.stringify(data, null, 2);
  const tmpPath = `${registryPath}.tmp`;

  // 确保目录存在
  await mkdir(dirname(registryPath), { recursive: true });

  await writeFile(tmpPath, json, 'utf8');
  await rename(tmpPath, registryPath);
}
