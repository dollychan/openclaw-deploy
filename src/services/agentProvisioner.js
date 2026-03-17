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
import { existsSync } from 'node:fs';
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
  const templateDir = resolve(cfg.templateDir);

  const agentDir = resolve(join(cfg.openclawWorkspacesDir, '..', 'agents', agentId, 'agent'));

  console.log(`[provisioner] Creating agent ${agentId} for visitor ${visitorId.slice(0, 12)}...`);

  // ── 步骤 1：创建 workspace 和 agentDir 目录 ────────────────────────────────
  await mkdir(workspacePath, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  await mkdir(join(cfg.openclawAgentsDir, agentId, 'sessions'), { recursive: true });

  // 从 main agent 复制 models.json（包含 provider 配置）
  const mainModelsJson = join(cfg.openclawAgentsDir, 'main', 'agent', 'models.json');
  const visitorModelsJson = join(agentDir, 'models.json');
  if (existsSync(mainModelsJson)) {
    await copyFile(mainModelsJson, visitorModelsJson);
  }

  // ── 步骤 2：从模板目录复制人设文件 ────────────────────────────────────────
  await copyTemplateFiles(templateDir, workspacePath);

  // ── 步骤 3：更新 openclaw.json（注册 Agent）──────────────────────────────
  await updateConfig((config) => {
    config.agents.list.push({
      id: agentId,
      workspace: workspacePath,
      agentDir,
      identity: {
        name: 'Assistant',
        emoji: '🤖',
      },
      sandbox: {
        mode: 'all',
        workspaceAccess: 'rw',
      },
      tools: {
        deny: ['exec', 'bash', 'computer'],
      },
    });
  }, cfg.openclawConfigPath);

  // ── 步骤 4：持久化 visitorId → agentId 映射 ───────────────────────────────
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
  let files;
  try {
    files = await readdir(templateDir);
  } catch {
    throw new Error(`Template directory not found: ${templateDir}. Please create it with SOUL.md, USER.md, AGENTS.md, IDENTITY.md.`);
  }

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
