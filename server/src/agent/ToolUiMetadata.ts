type ToolExecutionStatus = 'running' | 'done' | 'error'

export interface ToolUiMetadata {
  uiLabel: string
  uiSummary?: string
  uiGroup?: string
  uiGroupLabel?: string
  uiVisibility: 'activity' | 'grouped' | 'debug'
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null
}

function clampText(value: unknown, maxChars = 80): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (!text) return ''
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text
}

function getMode(args?: unknown, result?: unknown): 'fix' | 'generate' | undefined {
  const argsRecord = asRecord(args)
  const resultRecord = asRecord(result)
  const mode = String(argsRecord?.mode ?? resultRecord?.mode ?? '').trim()
  if (mode.startsWith('fix')) return 'fix'
  if (mode === 'generate') return 'generate'
  return undefined
}

function buildGroupedStep(uiGroup: string, uiGroupLabel: string): Pick<ToolUiMetadata, 'uiGroup' | 'uiGroupLabel' | 'uiVisibility'> {
  return {
    uiGroup,
    uiGroupLabel,
    uiVisibility: 'grouped',
  }
}

function buildSearchSummary(args?: unknown, status?: ToolExecutionStatus) {
  const query = clampText(asRecord(args)?.query, 42)
  if (status === 'running') return query ? `正在搜索“${query}”` : '正在搜索公开网页'
  return query ? `已搜索“${query}”` : '已完成联网搜索'
}

function buildFetchSummary(args?: unknown, result?: unknown, status?: ToolExecutionStatus) {
  const argsRecord = asRecord(args)
  const resultRecord = asRecord(result)
  const url = clampText(argsRecord?.url ?? resultRecord?.requestedUrl ?? resultRecord?.finalUrl, 64)
  if (status === 'running') return url ? `正在读取 ${url}` : '正在读取网页内容'
  return url ? `已读取 ${url}` : '已读取网页内容'
}

function buildSnippetEditSummary(args?: unknown, result?: unknown, status?: ToolExecutionStatus) {
  const argsRecord = asRecord(args)
  const resultRecord = asRecord(result)
  const filePath = clampText(argsRecord?.filePath ?? resultRecord?.filePath, 64)
  if (status === 'running') return filePath ? `正在修改 ${filePath}` : '正在修改工作区文件'
  if (resultRecord?.changed === true) return filePath ? `已修改 ${filePath}` : '已修改工作区文件'
  return filePath ? `未修改 ${filePath}` : '未修改工作区文件'
}

export function buildToolUiMetadata(params: {
  toolName: string
  args?: unknown
  result?: unknown
  status: ToolExecutionStatus
}): ToolUiMetadata {
  const { toolName, args, result, status } = params
  const mode = getMode(args, result)
  const argsRecord = asRecord(args)
  const resultRecord = asRecord(result)

  switch (toolName) {
    case 'native_tool_loop.run':
      return {
        uiLabel: '工具决策',
        uiSummary: status === 'running' ? '正在判断是否需要联网或操作文件' : '工具决策完成',
        uiVisibility: 'debug',
      }
    case 'domain_selector.selectPackages':
      return {
        ...buildGroupedStep(mode === 'fix' ? 'repair_scope' : 'task_scope', mode === 'fix' ? '理解问题' : '理解任务'),
        uiLabel: mode === 'fix' ? '理解问题' : '理解你的需求',
        uiSummary: status === 'running'
          ? (mode === 'fix' ? '正在理解这次出了什么问题' : '正在理解你想实现什么效果')
          : clampText(resultRecord?.reason, 72) || '需求已理解完成',
      }
    case 'reference_planner.decide':
      return {
        ...buildGroupedStep(mode === 'fix' ? 'repair_references' : 'reference_support', mode === 'fix' ? '补充修复资料' : '补充资料'),
        uiLabel: mode === 'fix' ? '判断还要补充什么资料' : '判断还要补充什么资料',
        uiSummary: status === 'running'
          ? '正在判断还需要补充哪些资料'
          : resultRecord?.action === 'generate'
            ? '已确认现有资料已经够用'
            : clampText(resultRecord?.reason, 72) || '资料补充判断已完成',
      }
    case 'context_assembler.loadPackages':
      return {
        ...buildGroupedStep(mode === 'fix' ? 'repair_capabilities' : 'local_capabilities', mode === 'fix' ? '读取修复参考文档' : '读取参考文档'),
        uiLabel: mode === 'fix' ? '读取修复参考文档' : '读取参考文档',
        uiSummary: status === 'running'
          ? (mode === 'fix' ? '正在读取修复参考文档' : '正在读取参考文档')
          : (mode === 'fix' ? '修复参考文档已准备好' : '参考文档已准备好'),
      }
    case 'doc_loader.readReferenceDocs':
      return {
        ...buildGroupedStep(mode === 'fix' ? 'repair_references' : 'reference_support', mode === 'fix' ? '补充修复资料' : '补充资料'),
        uiLabel: '读取参考文档',
        uiSummary: status === 'running'
          ? '正在读取参考文档'
          : Array.isArray(resultRecord?.loadedReferences) && resultRecord.loadedReferences.length
            ? `已读取 ${resultRecord.loadedReferences.length} 份参考文档`
            : '参考文档已读取完成',
      }
    case 'context_assembler.load':
      return {
        ...buildGroupedStep(mode === 'fix' ? 'repair_context_ready' : 'generation_context', mode === 'fix' ? '整理修复信息' : '整理生成信息'),
        uiLabel: mode === 'fix' ? '整理修复信息' : '整理生成信息',
        uiSummary: status === 'running' ? (mode === 'fix' ? '正在整理修复所需信息' : '正在整理生成所需信息') : (mode === 'fix' ? '修复所需信息已准备完成' : '生成所需信息已准备完成'),
      }
    case 'skill_tool_loop.decideNextAction':
      return {
        ...buildGroupedStep(mode === 'fix' ? 'repair_references' : 'reference_support', mode === 'fix' ? '补充修复资料' : '补充资料'),
        uiLabel: mode === 'fix' ? '判断修复所需资料' : '判断是否继续补充资料',
        uiSummary: status === 'running'
          ? (mode === 'fix' ? '正在判断是否需要补充修复文档' : '正在判断是否需要补充本地文档')
          : clampText(resultRecord?.decisionSummary ?? resultRecord?.reason, 72) || '已完成资料判断',
      }
    case 'doc_loader.readSkillDoc':
      return {
        ...buildGroupedStep(mode === 'fix' ? 'repair_references' : 'reference_support', mode === 'fix' ? '补充修复资料' : '补充资料'),
        uiLabel: '读取技能文档',
        uiSummary: status === 'running'
          ? `正在读取 ${clampText(argsRecord?.skillName, 28) || '技能文档'}`
          : `已读取 ${clampText(resultRecord?.skillName ?? argsRecord?.skillName, 28) || '技能文档'}`,
      }
    case 'skill_planner.selectSkills':
      return {
        ...buildGroupedStep(mode === 'fix' ? 'repair_references' : 'reference_support', mode === 'fix' ? '补充修复资料' : '补充资料'),
        uiLabel: '补选技能',
        uiSummary: status === 'running'
          ? '正在补选相关技能'
          : clampText(resultRecord?.reason, 72) || '已完成技能补选',
      }
    case 'skill_matcher.matchByKeywords':
      return {
        ...buildGroupedStep(mode === 'fix' ? 'repair_references' : 'reference_support', mode === 'fix' ? '补充修复资料' : '补充资料'),
        uiLabel: '补充匹配技能',
        uiSummary: status === 'running' ? '正在做兜底技能匹配' : '已完成兜底技能匹配',
      }
    case 'error_analyzer.analyze':
    case 'error_analyzer.diagnose':
      return {
        ...buildGroupedStep('issue_analysis', '分析问题'),
        uiLabel: '分析问题',
        uiSummary: status === 'running'
          ? '正在分析报错与根因'
          : clampText(resultRecord?.likelyCause ?? resultRecord?.category, 72) || '已完成问题分析',
      }
    case 'file_intelligence.inspect':
      return {
        uiLabel: '分析上传数据',
        uiSummary: status === 'running'
          ? '正在识别数据结构与可视化特征'
          : typeof resultRecord?.featureCount === 'number'
            ? `已识别 ${resultRecord.featureCount} 个要素`
            : '数据画像已完成',
        uiVisibility: 'activity',
      }
    case 'web_search.search':
      return {
        uiLabel: '联网搜索资料',
        uiSummary: buildSearchSummary(args, status),
        uiVisibility: 'activity',
      }
    case 'web_fetch.fetch':
      return {
        uiLabel: '读取网页',
        uiSummary: buildFetchSummary(args, result, status),
        uiVisibility: 'activity',
      }
    case 'snippet_edit.apply':
      return {
        uiLabel: '修改文件片段',
        uiSummary: buildSnippetEditSummary(args, result, status),
        uiVisibility: 'activity',
      }
    case 'code_generator.generateStream':
      return {
        uiLabel: '生成地图代码',
        uiSummary: status === 'running'
          ? '正在生成回复与地图代码'
          : resultRecord?.hasFinalCode === true
            ? '已生成地图页面'
            : '已生成文字回复',
        uiVisibility: 'activity',
      }
    case 'code_generator.fixError':
      return {
        uiLabel: '修复代码',
        uiSummary: status === 'running'
          ? '正在根据诊断结果修复代码'
          : resultRecord?.fixed === true
            ? '已生成修复后的代码'
            : '本轮未生成可用修复代码',
        uiVisibility: 'activity',
      }
    case 'code_patch.apply':
      if (mode === 'generate') {
        const changeKind = String(resultRecord?.changeKind ?? argsRecord?.changeKind ?? '').trim()
        return {
          uiLabel: changeKind === 'create' ? '展示首版代码' : '应用改动',
          uiSummary: status === 'running'
            ? (changeKind === 'create' ? '正在整理首版代码内容' : '正在整理这次代码改动')
            : (changeKind === 'create' ? '已高亮显示首版代码新增内容' : '已高亮显示本次代码改动'),
          uiVisibility: 'activity',
        }
      }
      return {
        uiLabel: '应用改动',
        uiSummary: status === 'running'
          ? '正在把修复改动应用到当前代码'
          : resultRecord?.fallbackMode === 'rewrite'
            ? '局部 patch 未完全命中，已回退为整页重写'
            : '已按局部 patch 应用修复改动',
        uiVisibility: 'activity',
      }
    case 'code_guard.validate':
    case 'code_verifier.validate':
      return {
        uiLabel: '校验结果',
        uiSummary: status === 'running'
          ? '正在检查生成结果'
          : typeof resultRecord?.issueCount === 'number'
            ? resultRecord.issueCount > 0
              ? `发现 ${resultRecord.issueCount} 个需要关注的问题`
              : '未发现明显问题'
            : '校验已完成',
        uiVisibility: 'activity',
      }
    case 'visual_inspector.capture':
      return {
        uiLabel: '截图地图页面',
        uiSummary: status === 'running' ? '正在渲染并截图页面' : '页面截图已完成',
        uiVisibility: 'activity',
      }
    case 'visual_inspector.diagnose':
      return {
        uiLabel: '视觉检查',
        uiSummary: status === 'running'
          ? '正在分析地图截图'
          : clampText(resultRecord?.summary ?? resultRecord?.diagnosis, 72) || '视觉检查已完成',
        uiVisibility: 'activity',
      }
    default:
      return {
        uiLabel: toolName,
        uiSummary: status === 'running' ? '正在执行' : undefined,
        uiVisibility: 'activity',
      }
  }
}

export function enrichToolExecutionChunk<T extends Record<string, unknown>>(chunk: T): T & ToolUiMetadata {
  const toolName = String(chunk.toolName || 'unknown')
  const status = chunk.type === 'tool_execution_start'
    ? 'running'
    : chunk.isError === true
      ? 'error'
      : 'done'
  const ui = buildToolUiMetadata({
    toolName,
    args: chunk.args,
    result: chunk.result,
    status,
  })

  return {
    ...chunk,
    ...ui,
  }
}
