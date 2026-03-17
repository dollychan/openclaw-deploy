/**
 * Cron Manager
 * 封装 `openclaw cron` CLI，为每位访客的 Agent 注册/删除定时任务
 *
 * CLI 调用格式（假设 openclaw 在 PATH 中）：
 *   openclaw cron add \
 *     --name    <taskId>               # 任务唯一标识，用于后续删除
 *     --cron    "<schedule>"           # 5 段 cron 表达式
 *     --session agent:<agentId>:main   # 路由到访客专属 agent
 *     --message "<message>"            # 触发时发送的消息
 *
 *   openclaw cron delete <taskId>
 *
 * 注：cron 结果不推送到外部渠道（OpenClaw cron 暂不支持飞书渠道），
 * 结果保留在 agent session 中，用户下次打开 widget 时可查看。
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * 为访客 agent 注册 cron 任务
 * @param {string} agentId
 * @param {{ id: string, schedule: string, message: string }} task
 * @returns {Promise<void>}
 */
export async function addCron(agentId, task) {
  const sessionKey = `agent:${agentId}:main`;

  const args = [
    'cron', 'add',
    '--name', task.id,
    '--cron', task.schedule,
    '--session', sessionKey,
    '--message', task.message,
  ];

  try {
    const { stdout, stderr } = await execFileAsync('openclaw', args);
    if (stderr) {
      console.warn(`[cron] openclaw cron add warnings: ${stderr}`);
    }
    console.log(`[cron] Registered cron job "${task.id}" for agent ${agentId}`);
  } catch (err) {
    const msg = err.stderr || err.message;
    throw new Error(`Failed to register cron job: ${msg}`);
  }
}

/**
 * 删除 cron 任务
 * @param {string} taskId - openclaw cron add 时使用的 --name 值
 * @returns {Promise<void>}
 */
export async function deleteCron(taskId) {
  try {
    await execFileAsync('openclaw', ['cron', 'delete', taskId]);
    console.log(`[cron] Deleted cron job "${taskId}"`);
  } catch (err) {
    const msg = err.stderr || err.message;
    throw new Error(`Failed to delete cron job: ${msg}`);
  }
}
