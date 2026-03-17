/**
 * AgentProvisioner - 为网页访客动态创建专属 OpenClaw Agent
 *
 * 完整流程：
 * 1. 生成唯一 agentId
 * 2. 创建 workspace 目录（从模板复制人设文件）
 * 3. 更新 openclaw.json（通过 configManager 批量写入）
 * 4. OpenClaw 检测到配置变更后热重载新 Agent（~1-2 秒）
 * 5. 持久化 visitorId → agentId 映射到 registry
 *
 * 幂等性保证：若步骤 3/5 失败，registry 不更新，下次请求会重试整个流程
 */

import { mkdir, copyFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { generateAgentId } from '../utils/idGen.js';
import { updateConfig } from './configManager.js';
import * as agentRegistry from './agentRegistry.js';

/**
 * 为访客预配置专属 Agent
 * @param {string} visitorId      - 访客唯一 ID（已验证）
 * @param {object} cfg            - 来自 config.js 的配置对象
 * @returns {Promise<string>}     - 返回新创建的 agentId
 */
export async function provisionAgent(visitorId, cfg) {
  const agentId = generateAgentId(cfg.agentIdPrefix);
  const workspacePath = resolve(join(cfg.openclawWorkspacesDir, agentId));
  const agentDir = join(cfg.openclawAgentsDir, agentId, 'agent');
  const templateDir = resolve(cfg.templateDir);

  console.log(`[provisioner] Creating agent ${agentId} for visitor ${visitorId.slice(0, 12)}...`);

  // ── 步骤 1：创建 workspace 目录并复制人设文件 ─────────────────────────────
  // agentDir / sessions / models.json 由 OpenClaw 在首次建立 session 时自动创建，
  // 无需手动预创建。
  await mkdir(workspacePath, { recursive: true });
  await copyTemplateFiles(templateDir, workspacePath);

  // ── 步骤 2：更新 openclaw.json（注册 Agent）──────────────────────────────
  // agentDir 必须写入配置：OpenClaw 依赖它确定 session 存储路径。
  // 若不设置，OpenClaw 会 fallback 到 ~/.openclaw/workspace-<agentId>，
  // 导致 session 写入错误位置。
  await updateConfig((config) => {
    config.agents.list.push({
      id: agentId,
      workspace: workspacePath,
      agentDir,
      identity: {
        name: 'Assistant',
        emoji: '🤖',
      },
      tools: {
        deny: ['exec', 'bash', 'computer'],
      },
    });
  }, cfg.openclawConfigPath);

  // ── 步骤 3：持久化 visitorId → agentId 映射 ───────────────────────────────
  // 放在最后：确保前面步骤全部成功后才写 registry
  // 若之前失败，registry 为空，下次请求会重新走完整 provision 流程（幂等）
  agentRegistry.set(visitorId, agentId, cfg.registryPath);

  console.log(`[provisioner] Agent ${agentId} ready for visitor ${visitorId.slice(0, 12)}.`);
  return agentId;
}

/**
 * 将模板目录中的所有文件复制到目标 workspace
 * @param {string} templateDir  - 模板目录路径
 * @param {string} workspacePath - 目标 workspace 路径
 */
async function copyTemplateFiles(templateDir, workspacePath) {
  let entries;
  try {
    entries = await readdir(templateDir, { withFileTypes: true });
  } catch {
    throw new Error(`Template directory not found: ${templateDir}. Please create it with SOUL.md, USER.md, AGENTS.md, IDENTITY.md.`);
  }

  const files = entries.filter((e) => e.isFile()).map((e) => e.name);

  if (files.length === 0) {
    throw new Error(`Template directory is empty: ${templateDir}`);
  }

  await Promise.all(
    files.map((file) =>
      copyFile(join(templateDir, file), join(workspacePath, file))
    )
  );

  console.log(`[provisioner] Copied ${files.length} template files to ${workspacePath}`);
}
