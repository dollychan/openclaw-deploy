/**
 * Task Manager
 * 管理每个访客的定时任务，持久化到 data/tasks.json
 *
 * 数据结构：
 * {
 *   "vis_xxx": [
 *     { id, name, schedule, message, createdAt }
 *   ]
 * }
 */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

/** @type {Map<string, Array>} visitorId → tasks[] */
const store = new Map();

let tasksPath = null;
let saveTimer = null;
let persisting = false;
let pendingAfterPersist = false;

/**
 * 从磁盘加载任务（服务启动时调用）
 * @param {string} path
 */
export async function load(path) {
  tasksPath = path;
  if (!existsSync(path)) return;

  try {
    const raw = await readFile(path, 'utf8');
    const data = JSON.parse(raw);
    for (const [visitorId, tasks] of Object.entries(data)) {
      store.set(visitorId, tasks);
    }
    const total = [...store.values()].reduce((n, t) => n + t.length, 0);
    console.log(`[tasks] Loaded ${total} tasks for ${store.size} visitors.`);
  } catch (err) {
    console.error('[tasks] Failed to load tasks:', err.message);
  }
}

/**
 * 获取访客的所有任务
 * @param {string} visitorId
 * @returns {Array}
 */
export function list(visitorId) {
  return store.get(visitorId) ?? [];
}

/**
 * 创建任务
 * @param {string} visitorId
 * @param {{ name: string, schedule: string, message: string }} task
 * @returns {object} 创建的任务
 */
export function create(visitorId, { name, schedule, message }) {
  const task = {
    id: `task_${randomBytes(6).toString('hex')}`,
    name,
    schedule,
    message,
    enabled: false,
    cronJobId: null,
    createdAt: new Date().toISOString(),
  };

  const tasks = store.get(visitorId) ?? [];
  tasks.push(task);
  store.set(visitorId, tasks);
  scheduleSave();

  return task;
}

/**
 * 更新任务字段（浅合并）
 * @param {string} visitorId
 * @param {string} taskId
 * @param {object} updates - 要更新的字段
 * @returns {object|null} 更新后的任务，或 null（未找到）
 */
const ALLOWED_UPDATE_KEYS = new Set(['enabled', 'cronJobId']);

export function update(visitorId, taskId, updates) {
  const tasks = store.get(visitorId);
  if (!tasks) return null;

  const idx = tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) return null;

  const safe = {};
  for (const key of ALLOWED_UPDATE_KEYS) {
    if (Object.hasOwn(updates, key)) safe[key] = updates[key];
  }

  tasks[idx] = { ...tasks[idx], ...safe };
  scheduleSave();
  return tasks[idx];
}

/**
 * 删除任务
 * @param {string} visitorId
 * @param {string} taskId
 * @returns {boolean} 是否删除成功
 */
export function remove(visitorId, taskId) {
  const tasks = store.get(visitorId);
  if (!tasks) return false;

  const idx = tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) return false;

  tasks.splice(idx, 1);
  if (tasks.length === 0) {
    store.delete(visitorId);
  }
  scheduleSave();
  return true;
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persist().catch((err) => console.error('[tasks] Failed to save tasks:', err.message));
  }, 100);
}

async function persist() {
  if (!tasksPath) return;
  if (persisting) {
    // 若已在写入，标记完成后需再写一次（避免覆盖掉更新的数据）
    pendingAfterPersist = true;
    return;
  }
  persisting = true;
  try {
    const data = Object.fromEntries(store);
    const json = JSON.stringify(data, null, 2);
    const tmp = `${tasksPath}.tmp`;
    await mkdir(dirname(tasksPath), { recursive: true });
    await writeFile(tmp, json, 'utf8');
    await rename(tmp, tasksPath);
  } finally {
    persisting = false;
    if (pendingAfterPersist) {
      pendingAfterPersist = false;
      persist().catch((err) => console.error('[tasks] Failed to save tasks:', err.message));
    }
  }
}
