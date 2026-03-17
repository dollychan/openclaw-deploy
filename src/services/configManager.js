/**
 * ConfigManager - 并发安全的 openclaw.json 读写管理器
 *
 * 核心设计：内部写队列 + 原子文件替换
 * - 多个并发访客同时触发 Agent 注册时，所有更新函数进入队列
 * - drainQueue() 一次性读取配置 → 批量应用所有更新 → 原子写入
 * - 50 个并发访客只触发 1 次文件 I/O，所有 Agent 批量注册
 * - Node.js 单线程特性保证队列操作无竞争
 */

import { readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import JSON5 from 'json5';

/** @type {Array<function(object): void>} 待应用的配置更新函数队列 */
const writeQueue = [];

/** @type {boolean} 是否正在执行批量写入 */
let isWriting = false;

/**
 * 将一个配置更新函数加入队列，并触发批量写入
 * 调用者无需等待写入完成（fire-and-forget），但可以 await 获取完成信号
 *
 * @param {function(object): void} updateFn - 接收解析后的配置对象，直接修改它
 * @param {string} configPath - openclaw.json 路径
 * @returns {Promise<void>} 当本次更新被写入磁盘后 resolve
 */
export function updateConfig(updateFn, configPath) {
  return new Promise((resolve, reject) => {
    // 将 updateFn 包装为带 resolve/reject 的任务
    writeQueue.push({ fn: updateFn, resolve, reject });

    // 若当前没有写入任务在运行，立即启动
    if (!isWriting) {
      drainQueue(configPath);
    }
  });
}

/**
 * 批量消费队列：读取一次配置 → 应用所有排队的更新 → 原子写入一次
 * @param {string} configPath
 */
async function drainQueue(configPath) {
  if (writeQueue.length === 0) return;

  isWriting = true;

  // 取出当前所有排队的任务（不含此后新加入的）
  const batch = writeQueue.splice(0, writeQueue.length);

  try {
    // 1. 读取并解析当前配置
    const config = await readConfig(configPath);

    // 确保基础结构存在
    if (!config.agents) config.agents = {};
    if (!Array.isArray(config.agents.list)) config.agents.list = [];
    if (!Array.isArray(config.bindings)) config.bindings = [];

    // 2. 依次应用所有更新函数
    for (const task of batch) {
      try {
        task.fn(config);
      } catch (err) {
        task.reject(err);
        // 单个更新函数失败不影响整批写入，该任务 reject，继续处理其他任务
      }
    }

    // 3. 原子写入：先写 .tmp，再 rename 替换
    await atomicWrite(configPath, config);

    // 4. 通知所有已成功应用的任务
    for (const task of batch) {
      // 未被 reject 的任务才 resolve（已 reject 的调用 resolve 也无害）
      task.resolve();
    }

    console.log(`[configManager] Batch wrote ${batch.length} agent update(s) to openclaw.json`);
  } catch (err) {
    // 整批写入失败：通知所有任务
    console.error('[configManager] Failed to write config batch:', err.message);
    for (const task of batch) {
      task.reject(err);
    }
  } finally {
    isWriting = false;

    // 若在本次写入期间又有新任务加入队列，继续处理
    if (writeQueue.length > 0) {
      drainQueue(configPath);
    }
  }
}

/**
 * 读取并解析 openclaw.json（支持 JSON5 格式）
 * 若文件不存在，返回最小初始配置结构
 * @param {string} configPath
 * @returns {Promise<object>}
 */
async function readConfig(configPath) {
  if (!existsSync(configPath)) {
    console.warn(`[configManager] Config file not found at ${configPath}, using empty skeleton.`);
    return {
      agents: { list: [] },
      bindings: [],
    };
  }

  const raw = await readFile(configPath, 'utf8');

  // OpenClaw 使用 JSON5 格式（支持注释和尾逗号）
  try {
    return JSON5.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse openclaw.json: ${err.message}`);
  }
}

/**
 * 原子写入配置文件
 * 先写 .tmp 临时文件，再 rename 替换目标文件
 * 即使进程在写入中途崩溃，原文件也不会损坏
 * @param {string} configPath
 * @param {object} config
 */
async function atomicWrite(configPath, config) {
  // 序列化为标准 JSON（OpenClaw 同时接受 JSON 和 JSON5）
  const json = JSON.stringify(config, null, 2);
  const tmpPath = `${configPath}.tmp`;

  await writeFile(tmpPath, json, 'utf8');
  await rename(tmpPath, configPath);
}
