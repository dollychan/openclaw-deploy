/**
 * /api/tasks
 *
 * GET    /api/tasks           - 获取当前访客的所有定时任务
 * POST   /api/tasks           - 创建定时任务
 * DELETE /api/tasks/:taskId   - 删除定时任务
 */

import { Router } from 'express';
import * as taskManager from '../services/taskManager.js';

// 合法的 cron 表达式格式（简单校验：5段，每段允许数字/*/,-）
const CRON_RE = /^(\S+\s){4}\S+$/;

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

  // 删除任务
  router.delete('/:taskId', (req, res) => {
    const { taskId } = req.params;
    const deleted = taskManager.remove(req.visitorId, taskId);

    if (!deleted) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json({ ok: true });
  });

  return router;
}
