import dotenv from 'dotenv'
import { existsSync } from 'fs'
import { resolve } from 'path'

dotenv.config({ path: resolve(import.meta.dirname, '../../.env') })

function envBoolean(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]
  if (raw == null || raw === '') return defaultValue
  const normalized = raw.trim().toLowerCase()
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false
  return defaultValue
}

function resolveSkillsDir(): string {
  const candidates = [
    process.env.SKILLS_DIR,
    // 本地开发（monorepo）：server/dist -> ../../skills
    resolve(import.meta.dirname, '../../skills'),
    // 容器运行（/app）：dist -> ../skills => /app/skills
    resolve(import.meta.dirname, '../skills'),
    '/app/skills',
    '/skills',
  ].filter((p): p is string => Boolean(p && p.trim()))

  for (const p of candidates) {
    if (existsSync(p)) return p
  }

  return candidates[0] || resolve(import.meta.dirname, '../../skills')
}

function resolveAdminCodebookPath(): string | undefined {
  const candidates = [
    process.env.ADMIN_CODEBOOK_XLSX_PATH,
    // 本地开发：server/src -> ../assets/admin/xzqh2020-03.xlsx
    resolve(import.meta.dirname, '../assets/admin/xzqh2020-03.xlsx'),
    // 兜底（部分运行目录结构）
    resolve(import.meta.dirname, '../../server/assets/admin/xzqh2020-03.xlsx'),
    '/app/server/assets/admin/xzqh2020-03.xlsx',
    '/app/assets/admin/xzqh2020-03.xlsx',
  ].filter((p): p is string => Boolean(p && p.trim()))

  for (const p of candidates) {
    if (existsSync(p)) return p
  }

  return candidates[0]
}

function resolveShareDir(): string {
  const candidates = [
    process.env.SHARE_DIR,
    // 本地开发：server/src -> ../data/share
    resolve(import.meta.dirname, '../data/share'),
    // 容器运行
    '/app/share',
    '/share',
  ].filter((p): p is string => Boolean(p && p.trim()))

  for (const p of candidates) {
    if (existsSync(p)) return p
  }

  return candidates[0] || resolve(import.meta.dirname, '../data/share')
}

function resolveRunDossierDir(): string {
  const candidates = [
    process.env.RUN_DOSSIER_DIR,
    resolve(import.meta.dirname, '../data/run-dossiers'),
    '/app/run-dossiers',
    '/run-dossiers',
  ].filter((p): p is string => Boolean(p && p.trim()))

  for (const p of candidates) {
    if (existsSync(p)) return p
  }

  return candidates[0] || resolve(import.meta.dirname, '../data/run-dossiers')
}

function resolveAgentWorkspaceRoot(): string {
  const candidates = [
    process.env.AGENT_WORKSPACE_ROOT,
    // 本地开发：server/src -> 项目根目录
    resolve(import.meta.dirname, '../..'),
    process.cwd(),
  ].filter((p): p is string => Boolean(p && p.trim()))

  for (const p of candidates) {
    if (existsSync(p)) return p
  }

  return candidates[0] || resolve(import.meta.dirname, '../..')
}

export const config = {
  port: parseInt(process.env.PORT || '3000'),
  nodeEnv: process.env.NODE_ENV || 'development',

  tiandituToken: process.env.TIANDITU_TOKEN || '',
  tiandituTokenCookie: {
    secure: envBoolean('TIANDITU_TOKEN_COOKIE_SECURE', false),
  },

  publicSamples: {
    basePath: process.env.PUBLIC_SAMPLE_BASE_PATH || process.env.VITE_BASE_PATH || '/ai/dev/',
    tiandituToken: process.env.PUBLIC_SAMPLE_TIANDITU_TOKEN || '4043dde46add842282bacc412299311d',
  },

  llm: {
    apiKey: process.env.DASHSCOPE_API_KEY || process.env.LLM_API_KEY || '',
    baseUrl: process.env.DASHSCOPE_BASE_URL || process.env.LLM_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    responsesBaseUrl: process.env.DASHSCOPE_RESPONSES_BASE_URL || 'https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1',
    model: process.env.LLM_MODEL || 'qwen3.5-plus',
    auxModel: process.env.AUX_LLM_MODEL || process.env.NATIVE_TOOL_LOOP_AUX_MODEL || 'qwen3-coder-next',
    nativeToolLoopAuxModel: process.env.NATIVE_TOOL_LOOP_AUX_MODEL || process.env.AUX_LLM_MODEL || 'qwen3-coder-next',
    maxOutputTokens: parseInt(process.env.LLM_MAX_OUTPUT_TOKENS || '8192'),
    requestTimeoutMs: parseInt(process.env.LLM_TIMEOUT_MS || '240000'),
    maxRetries: parseInt(process.env.LLM_MAX_RETRIES || '2'),
    recoveryRounds: parseInt(process.env.LLM_RECOVERY_ROUNDS || '1'),
  },

  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '52428800'),
    dir: process.env.UPLOAD_DIR || './uploads',
  },

  logLevel: process.env.LOG_LEVEL || 'info',

  // Skills 文档目录（支持本地与容器多种目录结构）
  skillsDir: resolveSkillsDir(),

  // 行政区划编码对照表（xlsx）
  adminCodebookXlsxPath: resolveAdminCodebookPath(),

  // 分享快照目录
  share: {
    dir: resolveShareDir(),
    thumbnail: {
      enabled: process.env.SHARE_THUMBNAIL_ENABLED !== 'false',
      baseUrl: process.env.SHARE_THUMBNAIL_BASE_URL || `http://127.0.0.1:${parseInt(process.env.PORT || '3000')}`,
      chromiumPath: process.env.THUMBNAIL_CHROMIUM_PATH || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '',
      timeoutMs: parseInt(process.env.SHARE_THUMBNAIL_TIMEOUT_MS || '12000'),
      waitAfterLoadMs: parseInt(process.env.SHARE_THUMBNAIL_WAIT_MS || '600'),
      maxConcurrentRenders: parseInt(process.env.SHARE_THUMBNAIL_MAX_CONCURRENT || '2'),
    },
  },

  runDossiers: {
    enabled: process.env.RUN_DOSSIER_ENABLED !== 'false',
    dir: resolveRunDossierDir(),
  },

  visualInspection: {
    enabled: process.env.VISUAL_INSPECTION_ENABLED !== 'false',
    model: process.env.VISUAL_INSPECTION_MODEL || 'qwen3.5-flash',
    baseUrl: process.env.VISUAL_INSPECTION_BASE_URL || `http://127.0.0.1:${parseInt(process.env.PORT || '3000')}`,
    chromiumPath: process.env.VISUAL_INSPECTION_CHROMIUM_PATH || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '',
    timeoutMs: parseInt(process.env.VISUAL_INSPECTION_TIMEOUT_MS || '35000'),
    waitAfterLoadMs: parseInt(process.env.VISUAL_INSPECTION_WAIT_MS || '2200'),
    viewportWidth: parseInt(process.env.VISUAL_INSPECTION_VIEWPORT_WIDTH || '1440'),
    viewportHeight: parseInt(process.env.VISUAL_INSPECTION_VIEWPORT_HEIGHT || '900'),
    maxCodeChars: parseInt(process.env.VISUAL_INSPECTION_MAX_CODE_CHARS || '400000'),
    llmTimeoutMs: parseInt(process.env.VISUAL_INSPECTION_LLM_TIMEOUT_MS || '45000'),
    maxConcurrentRenders: parseInt(process.env.VISUAL_INSPECTION_MAX_CONCURRENT || '2'),
  },

  agentRuntime: {
    mode: process.env.AGENT_RUNTIME_MODE
      || ((process.env.NODE_ENV || 'development') === 'development' ? 'agent_first_full' : 'shadow'),
    maxPlanRounds: parseInt(process.env.AGENT_MAX_PLAN_ROUNDS || '2'),
    maxVerifyRepairRounds: parseInt(process.env.AGENT_MAX_VERIFY_REPAIR_ROUNDS || '1'),
    enableVerifier: process.env.AGENT_ENABLE_VERIFIER === 'true',
    enableShadowEvents: process.env.AGENT_RUNTIME_SHADOW_EVENTS !== 'false',
  },

  agentTools: {
    enabled: process.env.AGENT_TOOLS_ENABLED !== 'false',
    workspaceRoot: resolveAgentWorkspaceRoot(),
    maxPlanSteps: parseInt(process.env.AGENT_TOOL_MAX_STEPS || '3'),
    fetch: {
      timeoutMs: parseInt(process.env.AGENT_FETCH_TIMEOUT_MS || '15000'),
      maxBytes: parseInt(process.env.AGENT_FETCH_MAX_BYTES || '524288'),
    },
    edit: {
      contextLines: parseInt(process.env.AGENT_EDIT_CONTEXT_LINES || '2'),
      maxSnippetChars: parseInt(process.env.AGENT_EDIT_MAX_SNIPPET_CHARS || '2400'),
    },
  },

  auth: {
    enabled: envBoolean('AUTH_ENABLED', false),
    cookieName: process.env.AUTH_COOKIE_NAME || 'tdt_auth',
    sharedSecret: process.env.AUTH_SHARED_SECRET || 'tdt-dev-shared-secret',
    loginPath: process.env.AUTH_LOGIN_PATH || '/sso/login',
    logoutPath: process.env.AUTH_LOGOUT_PATH || '/sso/logout',
    trustProxy: envBoolean('AUTH_TRUST_PROXY', true),
  },
}
