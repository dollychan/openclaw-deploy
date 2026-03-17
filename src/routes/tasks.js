/**
 * /api/tasks
 *
 * GET    /api/tasks                    - 获取当前访客的所有定时任务
 * POST   /api/tasks                    - 创建定时任务
 * DELETE /api/tasks/:taskId            - 删除定时任务
 * POST   /api/tasks/:taskId/enable     - 启用任务（注册 OpenClaw cron）
 * POST   /api/tasks/:taskId/disable    - 停用任务（删除 OpenClaw cron）
 */

import { Router } from 'express';
import * as taskManager from '../services/taskManager.js';
import * as agentRegistry from '../services/agentRegistry.js';
import * as cronManager from '../services/cronManager.js';

// 合法的 cron 表达式格式（简单校验：5段，每段允许数字/*/,-）
const CRON_RE = /^(\S+\s){4}\S+$/;

// 正在处理中的任务 ID 集合，防止并发 enable/disable 导致重复注册 cron
const inFlight = new Set();

export function createTasksRouter() {
  const router = Router();

  // 获取任务列表
  router.get('/', (req, res) => {
    const tasks = taskManager.list(req.visitorId);
    res.json({ tasks });
  });

  // 创建任务
  router.post('/', (req, res) => {
    const { name, schedule, message } = req.body ?? {};

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!schedule || !CRON_RE.test(schedule.trim())) {
      return res.status(400).json({ error: 'schedule must be a valid 5-part cron expression' });
    }
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'message is required' });
    }

    const tasks = taskManager.list(req.visitorId);
    if (tasks.length >= 10) {
      return res.status(400).json({ error: 'Maximum 10 tasks per visitor' });
    }

    const task = taskManager.create(req.visitorId, {
      name: name.trim().slice(0, 100),
      schedule: schedule.trim(),
      message: message.trim().slice(0, 500),
    });

    res.status(201).json({ task });
  });

  // 删除任务（若已启用则同时删除 cron）
  router.delete('/:taskId', async (req, res) => {
    const { taskId } = req.params;
    const tasks = taskManager.list(req.visitorId);
    const task = tasks.find((t) => t.id === taskId);

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // 若已启用，先删除 cron
    if (task.enabled && task.cronJobId) {
      try {
        await cronManager.deleteCron(task.cronJobId);
      } catch (err) {
        console.warn(`[tasks] Failed to delete cron on task removal: ${err.message}`);
      }
    }

    taskManager.remove(req.visitorId, taskId);
    res.json({ ok: true });
  });

  // 启用任务
  router.post('/:taskId/enable', async (req, res) => {
    const { taskId } = req.params;

    if (inFlight.has(taskId)) {
      return res.status(409).json({ error: 'Task is already being updated. Please wait.' });
    }

    const tasks = taskManager.list(req.visitorId);
    const task = tasks.find((t) => t.id === taskId);

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (task.enabled) {
      return res.json({ task });
    }

    // 前置检查：访客必须已有专属 agent
    const agentId = agentRegistry.get(req.visitorId);
    if (!agentId) {
      return res.status(400).json({ error: 'No agent provisioned yet. Please send a chat message first.' });
    }

    inFlight.add(taskId);
    try {
      await cronManager.addCron(agentId, task);
      const updated = taskManager.update(req.visitorId, taskId, { enabled: true, cronJobId: task.id });
      res.json({ task: updated });
    } catch (err) {
      console.error(`[tasks] Enable task failed: ${err.message}`);
      res.status(500).json({ error: 'Failed to register cron job. Please try again.' });
    } finally {
      inFlight.delete(taskId);
    }
  });

  // 停用任务
  router.post('/:taskId/disable', async (req, res) => {
    const { taskId } = req.params;

    if (inFlight.has(taskId)) {
      return res.status(409).json({ error: 'Task is already being updated. Please wait.' });
    }

    const tasks = taskManager.list(req.visitorId);
    const task = tasks.find((t) => t.id === taskId);

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (!task.enabled) {
      return res.json({ task });
    }

    inFlight.add(taskId);
    try {
      if (task.cronJobId) {
        await cronManager.deleteCron(task.cronJobId);
      }
      const updated = taskManager.update(req.visitorId, taskId, { enabled: false, cronJobId: null });
      res.json({ task: updated });
    } catch (err) {
      console.error(`[tasks] Disable task failed: ${err.message}`);
      res.status(500).json({ error: 'Failed to remove cron job. Please try again.' });
    } finally {
      inFlight.delete(taskId);
    }
  });

  return router;
}
