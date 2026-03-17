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
  const templateDir = resolve(cfg.templateDir);

  console.log(`[provisioner] Creating agent ${agentId} for visitor ${visitorId.slice(0, 12)}...`);

  // ── 步骤 1：创建 workspace 目录 ────────────────────────────────────────────
  await mkdir(workspacePath, { recursive: true });

  // ── 步骤 2：从模板目录复制人设文件 ────────────────────────────────────────
  await copyTemplateFiles(templateDir, workspacePath);

  // ── 步骤 3：更新 openclaw.json（注册 Agent + Binding）─────────────────────
  await updateConfig((config) => {
    // 注册 Agent
    config.agents.list.push({
      id: agentId,
      workspace: workspacePath,
      identity: {
        name: 'Assistant',
        emoji: '🤖',
      },
      // 沙箱设置：允许读写 workspace，禁止执行外部命令
      sandbox: {
        mode: 'all',
        workspaceAccess: 'rw',
      },
      tools: {
        deny: ['exec', 'bash', 'computer'],
      },
    });

    // 添加路由 Binding：将来自该访客的消息路由到专属 Agent
    // 注意：bindings 按"最先匹配"顺序，peer 精确匹配优先级最高
    config.bindings.unshift({
      agentId,
      match: {
        peer: `web:${visitorId}`,
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
