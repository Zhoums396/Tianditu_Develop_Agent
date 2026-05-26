import { createLLM } from '../llm/createLLM.js'
import { config } from '../config.js'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { CodePatchService } from './CodePatchService.js'
import type { CodeDiffPayload, PatchBlock, PatchBlockReport } from './CodePatchTypes.js'

const STREAM_TEXT_MIN_CHARS = 6
const STREAM_TEXT_KEEP_TAIL = 6
const STREAM_CODE_MIN_CHARS = 32
const STREAM_CODE_KEEP_TAIL = 3
const STREAM_FLUSH_INTERVAL_MS = 45
const RECOVERY_STREAM_CHUNK_SIZE = 160
const RECOVERY_STREAM_DELAY_MS = 10

type StreamOutputChunk = { type: 'text' | 'code_start' | 'code_delta' | 'code' | 'code_reset' | 'error'; content: string }
export type CodeGeneratorStreamChunk =
  | StreamOutputChunk
  | { type: 'code_diff'; data: CodeDiffPayload }
export type CodeGeneratorFixChunk =
  CodeGeneratorStreamChunk

/**
 * 知识驱动的 LLM 代码生成
 */
export class CodeGenerator {
  private patchService = new CodePatchService()

  constructor() {}

  /**
   * 生成地图代码（或纯文字回复，由 LLM 自主判断）
   */
  async generate(params: {
    userInput: string
    skillDocs: string
    skillCatalog?: string
    apiContractsPrompt?: string
    conversationHistory?: string
    existingCode?: string
    fileData?: string
    toolContext?: string
  }): Promise<{ code: string; explanation: string }> {
    const systemPrompt = this.buildSystemPrompt({
      skillDocs: params.skillDocs,
      skillCatalog: params.skillCatalog,
      apiContractsPrompt: params.apiContractsPrompt,
    })
    const userPrompt = this.buildUserPrompt(params)

    const llm = createLLM({ temperature: 0.3 })
    const response = await llm.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt),
    ])

    const content = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content)

    const parsed = this.parseResponse(content)
    if (parsed.code) return parsed

    const htmlLikelyExpected = /```html|<!doctype\s+html|<html\b/i.test(content)
    if (htmlLikelyExpected) {
      const retried = await this.retryCompleteHtml({
        systemPrompt,
        userPrompt,
      })
      if (retried.code) {
        return {
          code: retried.code,
          explanation: [parsed.explanation, retried.explanation].filter(Boolean).join('\n\n').trim(),
        }
      }
    }

    return parsed
  }

  /**
   * 修复代码错误
   */
  async fixError(params: {
    code: string
    error: string
    skillDocs: string
    apiContractsPrompt?: string
    fileData?: string
    errorDiagnosis?: string
  }): Promise<{ code: string; explanation: string; diff?: CodeDiffPayload }> {
    let explanation = ''
    let code = ''
    let diff: CodeDiffPayload | undefined

    for await (const chunk of this.fixErrorStream(params)) {
      if (chunk.type === 'text') {
        explanation += chunk.content
      } else if (chunk.type === 'code') {
        code = chunk.content
      } else if (chunk.type === 'code_diff') {
        diff = chunk.data
      }
    }

    return {
      code: code || params.code,
      explanation: explanation.trim(),
      diff,
    }
  }

  /**
   * 流式修复代码错误：让前端在自动修复阶段也能实时看到修复分析和代码增量
   */
  async *fixErrorStream(params: {
    code: string
    error: string
    skillDocs: string
    apiContractsPrompt?: string
    fileData?: string
    errorDiagnosis?: string
  }): AsyncGenerator<CodeGeneratorFixChunk> {
    const maxPatchRetryRounds = Math.max(1, config.llm.recoveryRounds || 1)
    const aggregatedReports: PatchBlockReport[] = []
    const aggregatedBlocks: PatchBlock[] = []
    const patchTexts: string[] = []
    let currentCode = params.code
    let nextBlockIndex = 0

    try {
      const firstAttempt = this.streamPatchPlanResponse({
        systemPrompt: this.buildFixPatchSystemPrompt({
          skillDocs: params.skillDocs,
          apiContractsPrompt: params.apiContractsPrompt,
        }),
        userPrompt: this.buildFixPatchUserPrompt(params),
      })

      for await (const chunk of firstAttempt.chunks) {
        yield chunk
      }

      let attemptBlocks = this.patchService
        .parseSearchReplaceBlocks(firstAttempt.patchText || firstAttempt.fullContent)
        .map((block) => ({ ...block, blockIndex: nextBlockIndex + block.blockIndex }))
      if (attemptBlocks.length > 0) {
        aggregatedBlocks.push(...attemptBlocks)
        patchTexts.push(firstAttempt.patchText || firstAttempt.fullContent)
        nextBlockIndex += attemptBlocks.length
      }

      let latestApply = attemptBlocks.length > 0
        ? this.patchService.applyBlocks({
          originalCode: currentCode,
          fileName: 'preview.html',
          blocks: attemptBlocks,
        })
        : null

      if (latestApply) {
        aggregatedReports.push(...latestApply.blockReports)
        currentCode = latestApply.newCode
        if (latestApply.success) {
          yield { type: 'text', content: '\n\n已按局部 patch 完成自动修复，正在生成改动视图。' }
          const diffPayload = this.patchService.buildCodeDiffPayload({
            beforeCode: params.code,
            afterCode: currentCode,
            fallbackMode: 'patch',
            blockReports: aggregatedReports,
            patchBlocks: aggregatedBlocks,
            patchText: patchTexts.join('\n\n'),
            summary: summarizePatchReports(aggregatedReports),
            fileName: 'preview.html',
          })
          yield { type: 'code_diff', data: diffPayload }
          yield { type: 'code', content: currentCode }
          return
        }
      }

      let remainingFailures = latestApply?.blockReports.filter((report) => report.status === 'failed') || []
      if (!latestApply && attemptBlocks.length === 0) {
        remainingFailures = [
          createProtocolFailureReport(nextBlockIndex, firstAttempt.fullContent),
        ]
        aggregatedReports.push(...remainingFailures)
      }
      for (let round = 0; round < maxPatchRetryRounds && remainingFailures.length > 0; round += 1) {
        yield {
          type: 'text',
          content: `\n\n局部 patch 仍有 ${remainingFailures.length} 处需要纠正，正在按失败块重试第 ${round + 1} 轮。`,
        }
        const retryResponse = await this.generatePatchRetryResponse({
          code: currentCode,
          error: params.error,
          errorDiagnosis: params.errorDiagnosis,
          failedReports: remainingFailures,
          skillDocs: params.skillDocs,
          apiContractsPrompt: params.apiContractsPrompt,
          fileData: params.fileData,
        })
        if (retryResponse.explanation) {
          yield { type: 'text', content: `\n\n${retryResponse.explanation}` }
        }

        const retryBlocks = this.patchService
          .parseSearchReplaceBlocks(retryResponse.patchText || retryResponse.fullContent)
          .map((block) => ({ ...block, blockIndex: nextBlockIndex + block.blockIndex }))

        if (retryBlocks.length === 0) {
          remainingFailures = [
            createProtocolFailureReport(nextBlockIndex, retryResponse.fullContent),
          ]
          aggregatedReports.push(...remainingFailures)
          continue
        }

        aggregatedBlocks.push(...retryBlocks)
        patchTexts.push(retryResponse.patchText || retryResponse.fullContent)
        nextBlockIndex += retryBlocks.length

        const retryApply = this.patchService.applyBlocks({
          originalCode: currentCode,
          fileName: 'preview.html',
          blocks: retryBlocks,
        })
        aggregatedReports.push(...retryApply.blockReports)
        currentCode = retryApply.newCode
        if (retryApply.success) {
          const diffPayload = this.patchService.buildCodeDiffPayload({
            beforeCode: params.code,
            afterCode: currentCode,
            fallbackMode: 'patch',
            blockReports: aggregatedReports,
            patchBlocks: aggregatedBlocks,
            patchText: patchTexts.join('\n\n'),
            summary: summarizePatchReports(aggregatedReports),
            fileName: 'preview.html',
          })
          yield { type: 'code_diff', data: diffPayload }
          yield { type: 'code', content: currentCode }
          return
        }
        remainingFailures = retryApply.blockReports.filter((report) => report.status === 'failed')
      }

      yield { type: 'text', content: '\n\n局部 patch 未能稳定完成，正在回退到整页重写修复。' }
      let rewriteCode = ''
      for await (const chunk of this.fixErrorRewriteStream(params)) {
        if (chunk.type === 'code') {
          rewriteCode = chunk.content
          continue
        }
        yield chunk
      }

      if (rewriteCode) {
        const diffPayload = this.patchService.buildCodeDiffPayload({
          beforeCode: params.code,
          afterCode: rewriteCode,
          fallbackMode: 'rewrite',
          blockReports: aggregatedReports,
          patchBlocks: aggregatedBlocks,
          patchText: patchTexts.join('\n\n'),
          summary: '局部 patch 未能稳定完成，已回退为整页重写修复。',
          fileName: 'preview.html',
        })
        yield { type: 'code_diff', data: diffPayload }
        yield { type: 'code', content: rewriteCode }
        return
      }

      yield {
        type: 'error',
        content: '局部 patch 与整页重写均未生成可用修复结果，请重试或缩小修复范围。',
      }
    } catch (err: any) {
      yield { type: 'error' as const, content: err.message }
    }
  }

  /**
   * 流式生成：文字和代码都实时流式推送
   *
   * 事件类型：
   * - text: 说明文字（逐段推送）
   * - code_start: 代码块开始（通知前端展开代码面板）
   * - code_delta: 代码增量内容（逐段推送，前端拼接显示）
   * - code: 完整代码（代码块结束后推送，用于最终渲染地图）
   * - error: 错误信息
   */
  async *generateStream(params: {
    userInput: string
    skillDocs: string
    skillCatalog?: string
    apiContractsPrompt?: string
    conversationHistory?: string
    existingCode?: string
    fileData?: string
    toolContext?: string
  }): AsyncGenerator<CodeGeneratorStreamChunk> {
    const systemPrompt = this.buildSystemPrompt({
      skillDocs: params.skillDocs,
      skillCatalog: params.skillCatalog,
      apiContractsPrompt: params.apiContractsPrompt,
    })
    const userPrompt = this.buildUserPrompt(params)

    try {
      if (params.existingCode) {
        const patchHandled = yield* this.generateUpdatedCodeByPatchStream({
          userInput: params.userInput,
          conversationHistory: params.conversationHistory,
          existingCode: params.existingCode,
          fileData: params.fileData,
          toolContext: params.toolContext,
          skillDocs: params.skillDocs,
          skillCatalog: params.skillCatalog,
          apiContractsPrompt: params.apiContractsPrompt,
          fullGenerationSystemPrompt: systemPrompt,
          fullGenerationUserPrompt: userPrompt,
        })
        if (patchHandled) {
          return
        }
      }

      yield* this.streamWholeDocumentGeneration({
        systemPrompt,
        userPrompt,
        beforeCodeForDiff: params.existingCode || '',
      })
    } catch (err: any) {
      yield { type: 'error' as const, content: err.message }
    }
  }

  private async *generateUpdatedCodeByPatchStream(params: {
    userInput: string
    conversationHistory?: string
    existingCode: string
    fileData?: string
    toolContext?: string
    skillDocs: string
    skillCatalog?: string
    apiContractsPrompt?: string
    fullGenerationSystemPrompt: string
    fullGenerationUserPrompt: string
  }): AsyncGenerator<CodeGeneratorStreamChunk, boolean, void> {
    const maxPatchRetryRounds = Math.max(1, config.llm.recoveryRounds || 1)
    const aggregatedReports: PatchBlockReport[] = []
    const aggregatedBlocks: PatchBlock[] = []
    const patchTexts: string[] = []
    let currentCode = params.existingCode
    let nextBlockIndex = 0

    const firstAttempt = this.streamPatchPlanResponse({
      systemPrompt: this.buildGeneratePatchSystemPrompt({
        skillDocs: params.skillDocs,
        skillCatalog: params.skillCatalog,
        apiContractsPrompt: params.apiContractsPrompt,
      }),
      userPrompt: this.buildGeneratePatchUserPrompt({
        userInput: params.userInput,
        conversationHistory: params.conversationHistory,
        existingCode: params.existingCode,
        fileData: params.fileData,
        toolContext: params.toolContext,
      }),
    })

    for await (const chunk of firstAttempt.chunks) {
      yield chunk
    }

    let attemptBlocks = this.patchService
      .parseSearchReplaceBlocks(firstAttempt.patchText || firstAttempt.fullContent)
      .map((block) => ({ ...block, blockIndex: nextBlockIndex + block.blockIndex }))
    if (attemptBlocks.length > 0) {
      aggregatedBlocks.push(...attemptBlocks)
      patchTexts.push(firstAttempt.patchText || firstAttempt.fullContent)
      nextBlockIndex += attemptBlocks.length
    }

    let latestApply = attemptBlocks.length > 0
      ? this.patchService.applyBlocks({
        originalCode: currentCode,
        fileName: 'preview.html',
        blocks: attemptBlocks,
      })
      : null

    if (latestApply) {
      aggregatedReports.push(...latestApply.blockReports)
      currentCode = latestApply.newCode
      if (latestApply.success) {
        yield { type: 'text', content: '\n\n已按局部 patch 完成需求更新，正在生成改动视图。' }
        yield { type: 'code', content: currentCode }
        yield {
          type: 'code_diff',
          data: this.patchService.buildCodeDiffPayload({
            beforeCode: params.existingCode,
            afterCode: currentCode,
            fallbackMode: 'patch',
            blockReports: aggregatedReports,
            patchBlocks: aggregatedBlocks,
            patchText: patchTexts.join('\n\n'),
            summary: summarizeUpdatePatchReports(aggregatedReports),
            fileName: 'preview.html',
          }),
        }
        return true
      }
    }

    let remainingFailures = latestApply?.blockReports.filter((report) => report.status === 'failed') || []
    if (!latestApply && attemptBlocks.length === 0) {
      remainingFailures = [
        createProtocolFailureReport(nextBlockIndex, firstAttempt.fullContent),
      ]
      aggregatedReports.push(...remainingFailures)
    }

    for (let round = 0; round < maxPatchRetryRounds && remainingFailures.length > 0; round += 1) {
      yield {
        type: 'text',
        content: `\n\n局部 patch 仍有 ${remainingFailures.length} 处需要纠正，正在按失败块重试第 ${round + 1} 轮。`,
      }
      const retryResponse = await this.generateUpdatePatchRetryResponse({
        code: currentCode,
        userInput: params.userInput,
        conversationHistory: params.conversationHistory,
        failedReports: remainingFailures,
        skillDocs: params.skillDocs,
        skillCatalog: params.skillCatalog,
        apiContractsPrompt: params.apiContractsPrompt,
        fileData: params.fileData,
        toolContext: params.toolContext,
      })
      if (retryResponse.explanation) {
        yield { type: 'text', content: `\n\n${retryResponse.explanation}` }
      }

      const retryBlocks = this.patchService
        .parseSearchReplaceBlocks(retryResponse.patchText || retryResponse.fullContent)
        .map((block) => ({ ...block, blockIndex: nextBlockIndex + block.blockIndex }))

      if (retryBlocks.length === 0) {
        remainingFailures = [
          createProtocolFailureReport(nextBlockIndex, retryResponse.fullContent),
        ]
        aggregatedReports.push(...remainingFailures)
        continue
      }

      aggregatedBlocks.push(...retryBlocks)
      patchTexts.push(retryResponse.patchText || retryResponse.fullContent)
      nextBlockIndex += retryBlocks.length

      const retryApply = this.patchService.applyBlocks({
        originalCode: currentCode,
        fileName: 'preview.html',
        blocks: retryBlocks,
      })
      aggregatedReports.push(...retryApply.blockReports)
      currentCode = retryApply.newCode

      if (retryApply.success) {
        yield { type: 'text', content: '\n\n已按局部 patch 完成需求更新，正在生成改动视图。' }
        yield { type: 'code', content: currentCode }
        yield {
          type: 'code_diff',
          data: this.patchService.buildCodeDiffPayload({
            beforeCode: params.existingCode,
            afterCode: currentCode,
            fallbackMode: 'patch',
            blockReports: aggregatedReports,
            patchBlocks: aggregatedBlocks,
            patchText: patchTexts.join('\n\n'),
            summary: summarizeUpdatePatchReports(aggregatedReports),
            fileName: 'preview.html',
          }),
        }
        return true
      }

      remainingFailures = retryApply.blockReports.filter((report) => report.status === 'failed')
    }

    yield { type: 'text', content: '\n\n局部 patch 未能稳定完成，正在回退到整页生成。' }
    yield* this.streamWholeDocumentGeneration({
      systemPrompt: params.fullGenerationSystemPrompt,
      userPrompt: params.fullGenerationUserPrompt,
      beforeCodeForDiff: params.existingCode,
    })
    return true
  }

  private async *streamWholeDocumentGeneration(params: {
    systemPrompt: string
    userPrompt: string
    beforeCodeForDiff: string
  }): AsyncGenerator<CodeGeneratorStreamChunk> {
      const streamed = this.streamModelResponse({
        systemPrompt: params.systemPrompt,
        userPrompt: params.userPrompt,
      })
      let streamedFinalCode = ''

      for await (const chunk of streamed.chunks) {
        if (chunk.type === 'code' && !streamedFinalCode) {
          streamedFinalCode = chunk.content
        }
        yield chunk
      }

      let finalCode = streamedFinalCode
      const codeLikelyExpected =
        streamed.codeStartEmitted || streamed.codeBuffer.trim().length > 0 || /```html/i.test(streamed.fullContent)

      // 只有在流式阶段从未得到完整 HTML 时，才进入恢复链路
      if (!finalCode) {
        const parsed = this.parseResponse(streamed.fullContent)
        finalCode = parsed.code
      }

      // 第一层兜底：代码块未闭合时，优先用 code_delta 还原
      if (!finalCode && codeLikelyExpected) {
        const recovered = this.recoverCodeFromCodeDelta(streamed.codeBuffer)
        if (recovered) {
          finalCode = recovered
          yield { type: 'text' as const, content: '\n\n检测到输出在代码中途结束，已使用流式代码自动收尾。' }
          for await (const recoveryChunk of this.streamRecoveredHtml({
            recoveredCode: recovered,
            existingCode: streamed.codeBuffer,
            codeStartEmitted: streamed.codeStartEmitted,
          })) {
            yield recoveryChunk
          }
        }
      }

      // 第二层兜底：自动重试一轮，要求模型直接返回完整 HTML
      if (!finalCode && codeLikelyExpected) {
        const retried = this.retryCompleteHtmlStream({
          systemPrompt: params.systemPrompt,
          userPrompt: params.userPrompt,
          existingCode: streamed.codeBuffer,
          codeStartEmitted: streamed.codeStartEmitted,
        })
        for await (const recoveryChunk of retried.chunks) {
          yield recoveryChunk
        }
        if (retried.code) {
          finalCode = retried.code
          if (retried.explanation) {
            yield { type: 'text' as const, content: `\n\n${retried.explanation}` }
          }
        }
      }

      if (!finalCode && codeLikelyExpected) {
        const fallback = await this.retryCompleteHtml({
          systemPrompt: params.systemPrompt,
          userPrompt: params.userPrompt,
        })
        if (fallback.code) {
          finalCode = fallback.code
          for await (const recoveryChunk of this.streamRecoveredHtml({
            recoveredCode: fallback.code,
            existingCode: streamed.codeBuffer,
            codeStartEmitted: streamed.codeStartEmitted,
          })) {
            yield recoveryChunk
          }
          if (fallback.explanation) {
            yield { type: 'text' as const, content: `\n\n${fallback.explanation}` }
          }
        }
      }

      if (finalCode) {
        if (!streamedFinalCode) {
          yield { type: 'code' as const, content: finalCode }
        }
        const beforeCode = params.beforeCodeForDiff
        const shouldEmitDiff =
          normalizeComparableCode(beforeCode) !== normalizeComparableCode(finalCode)

        if (shouldEmitDiff) {
          const diffPayload = this.patchService.buildCodeDiffPayload({
            beforeCode,
            afterCode: finalCode,
            fallbackMode: 'patch',
            blockReports: [],
            summary: beforeCode.trim().length > 0
              ? '已根据新需求更新现有代码，以下高亮显示本次改动。'
              : '已生成首版代码，以下高亮显示从空文件到当前页面的新增内容。',
            fileName: 'preview.html',
          })
          yield { type: 'code_diff', data: diffPayload }
        }
      } else {
        // 纯文字回答场景：没有代码输出是合法结果，不应误判为截断
        if (!codeLikelyExpected) return
        yield {
          type: 'error' as const,
          content: '输出不完整：未得到可用的最终 HTML 代码，请重试或缩小本次需求范围。',
        }
      }
  }

  private async *fixErrorRewriteStream(params: {
    code: string
    error: string
    skillDocs: string
    apiContractsPrompt?: string
    fileData?: string
    errorDiagnosis?: string
  }): AsyncGenerator<StreamOutputChunk> {
    const systemPrompt = this.buildFixSystemPrompt({
      skillDocs: params.skillDocs,
      apiContractsPrompt: params.apiContractsPrompt,
    })
    const userPrompt = this.buildFixUserPrompt(params)

    const streamed = this.streamModelResponse({
      systemPrompt,
      userPrompt,
    })
    let streamedFinalCode = ''

    for await (const chunk of streamed.chunks) {
      if (chunk.type === 'code' && !streamedFinalCode) {
        streamedFinalCode = chunk.content
      }
      yield chunk
    }

    let finalCode = streamedFinalCode

    if (!finalCode) {
      const parsed = this.parseResponse(streamed.fullContent)
      finalCode = parsed.code
    }

    if (!finalCode) {
      const recovered = this.recoverCodeFromCodeDelta(streamed.codeBuffer)
      if (recovered) {
        finalCode = recovered
        yield { type: 'text', content: '\n\n检测到修复输出被截断，已使用流式代码自动收尾。' }
        for await (const recoveryChunk of this.streamRecoveredHtml({
          recoveredCode: recovered,
          existingCode: streamed.codeBuffer,
          codeStartEmitted: streamed.codeStartEmitted,
        })) {
          yield recoveryChunk
        }
      }
    }

    if (!finalCode) {
      const retried = this.retryCompleteHtmlStream({
        systemPrompt,
        userPrompt,
        existingCode: streamed.codeBuffer,
        codeStartEmitted: streamed.codeStartEmitted,
      })
      for await (const recoveryChunk of retried.chunks) {
        yield recoveryChunk
      }
      if (retried.code) {
        finalCode = retried.code
        if (retried.explanation) {
          yield { type: 'text', content: `\n\n${retried.explanation}` }
        }
      }
    }

    if (!finalCode) {
      const fallback = await this.retryCompleteHtml({
        systemPrompt,
        userPrompt,
      })
      if (fallback.code) {
        finalCode = fallback.code
        for await (const recoveryChunk of this.streamRecoveredHtml({
          recoveredCode: fallback.code,
          existingCode: streamed.codeBuffer,
          codeStartEmitted: streamed.codeStartEmitted,
        })) {
          yield recoveryChunk
        }
        if (fallback.explanation) {
          yield { type: 'text', content: `\n\n${fallback.explanation}` }
        }
      }
    }

    if (finalCode && !streamedFinalCode) {
      yield { type: 'code', content: finalCode }
      return
    }

    if (!finalCode) {
      yield {
        type: 'error',
        content: '修复输出不完整：未得到可用的最终 HTML 代码，请重试或简化修复目标。',
      }
    }
  }

  private streamPatchPlanResponse(params: {
    systemPrompt: string
    userPrompt: string
  }): {
    chunks: AsyncGenerator<StreamOutputChunk>
    fullContent: string
    patchText: string
  } {
    let fullContent = ''
    let patchText = ''
    const markers = ['------- SEARCH', '<<<<<<< SEARCH']
    const maxMarkerLength = Math.max(...markers.map((marker) => marker.length))

    const chunks = (async function* (): AsyncGenerator<StreamOutputChunk> {
      const llm = createLLM({ temperature: 0.2 })
      const stream = await llm.stream([
        new SystemMessage(params.systemPrompt),
        new HumanMessage(params.userPrompt),
      ])

      let textBuffer = ''
      let patchStarted = false

      for await (const chunk of stream) {
        const text = typeof chunk.content === 'string' ? chunk.content : ''
        if (!text) continue
        fullContent += text

        if (patchStarted) {
          patchText += text
          continue
        }

        textBuffer += text
        const markerIndex = findPatchMarkerIndex(textBuffer)
        if (markerIndex >= 0) {
          const explanation = textBuffer.slice(0, markerIndex)
          if (explanation) {
            yield { type: 'text', content: explanation }
          }
          patchText += textBuffer.slice(markerIndex)
          textBuffer = ''
          patchStarted = true
          continue
        }

        if (textBuffer.length > maxMarkerLength + STREAM_TEXT_KEEP_TAIL) {
          const flush = textBuffer.slice(0, textBuffer.length - maxMarkerLength)
          if (flush) {
            yield { type: 'text', content: flush }
            textBuffer = textBuffer.slice(textBuffer.length - maxMarkerLength)
          }
        }
      }

      if (textBuffer) {
        if (patchStarted) {
          patchText += textBuffer
        } else {
          yield { type: 'text', content: textBuffer }
        }
      }
    })()

    return {
      chunks,
      get fullContent() {
        return fullContent
      },
      get patchText() {
        return patchText
      },
    }
  }

  private async generatePatchRetryResponse(params: {
    code: string
    error: string
    errorDiagnosis?: string
    failedReports: PatchBlockReport[]
    skillDocs: string
    apiContractsPrompt?: string
    fileData?: string
  }): Promise<{ explanation: string; patchText: string; fullContent: string }> {
    const systemPrompt = this.buildFixPatchSystemPrompt({
      skillDocs: params.skillDocs,
      apiContractsPrompt: params.apiContractsPrompt,
    })
    const userPrompt = this.buildFixPatchRetryUserPrompt(params)
    return this.invokePatchResponse({
      systemPrompt,
      userPrompt,
    })
  }

  private async generateUpdatePatchRetryResponse(params: {
    code: string
    userInput: string
    conversationHistory?: string
    failedReports: PatchBlockReport[]
    skillDocs: string
    skillCatalog?: string
    apiContractsPrompt?: string
    fileData?: string
    toolContext?: string
  }): Promise<{ explanation: string; patchText: string; fullContent: string }> {
    const systemPrompt = this.buildGeneratePatchSystemPrompt({
      skillDocs: params.skillDocs,
      skillCatalog: params.skillCatalog,
      apiContractsPrompt: params.apiContractsPrompt,
    })
    const userPrompt = this.buildGeneratePatchRetryUserPrompt(params)
    return this.invokePatchResponse({
      systemPrompt,
      userPrompt,
    })
  }

  private async invokePatchResponse(params: {
    systemPrompt: string
    userPrompt: string
  }): Promise<{ explanation: string; patchText: string; fullContent: string }> {
    const llm = createLLM({ temperature: 0.2 })
    const response = await llm.invoke([
      new SystemMessage(params.systemPrompt),
      new HumanMessage(params.userPrompt),
    ])
    const content = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content)
    const patchBlocks = this.patchService.parseSearchReplaceBlocks(content)
    const markerIndex = findPatchMarkerIndex(content)

    return {
      explanation: markerIndex > 0 ? content.slice(0, markerIndex).trim() : '',
      patchText: patchBlocks.length > 0
        ? content.slice(Math.max(0, markerIndex))
        : '',
      fullContent: content,
    }
  }

  private streamModelResponse(params: {
    systemPrompt: string
    userPrompt: string
  }): {
    chunks: AsyncGenerator<StreamOutputChunk>
    fullContent: string
    codeBuffer: string
    codeStartEmitted: boolean
    finalCode: string
  } {
    let fullContent = ''
    let codeBuffer = ''
    let codeStartEmitted = false
    let finalCode = ''

    const chunks = (async function* (self: CodeGenerator): AsyncGenerator<StreamOutputChunk> {
      const llm = createLLM({ temperature: 0.3 })
      const stream = await llm.stream([
        new SystemMessage(params.systemPrompt),
        new HumanMessage(params.userPrompt),
      ])

      let inCodeBlock = false
      let suppressCodeTail = false
      let textBuffer = ''
      let lastTextFlushAt = Date.now()
      let lastCodeFlushAt = Date.now()

      for await (const chunk of stream) {
        const text = typeof chunk.content === 'string' ? chunk.content : ''
        if (!text) continue
        fullContent += text

        for (const char of text) {
          textBuffer += char

          if (!inCodeBlock && textBuffer.endsWith('```html')) {
            if (finalCode) {
              textBuffer = ''
              inCodeBlock = true
              suppressCodeTail = true
              continue
            }
            const beforeCode = textBuffer.slice(0, -7)
            if (beforeCode) {
              yield { type: 'text', content: beforeCode }
              lastTextFlushAt = Date.now()
            }
            textBuffer = ''
            inCodeBlock = true
            suppressCodeTail = Boolean(finalCode)
            if (!codeStartEmitted) {
              codeStartEmitted = true
              yield { type: 'code_start', content: '' }
            }
            lastCodeFlushAt = Date.now()
            continue
          }

          if (inCodeBlock && textBuffer.endsWith('```')) {
            const lastCodeChunk = textBuffer.slice(0, -3)
            if (lastCodeChunk) {
              if (!suppressCodeTail) {
                const completed = self.extractFirstCompleteHtmlDocument(`${codeBuffer}${lastCodeChunk}`)
                if (completed) {
                  finalCode = completed
                  suppressCodeTail = true
                  yield { type: 'code', content: completed }
                  textBuffer = ''
                } else {
                  codeBuffer += lastCodeChunk
                  yield { type: 'code_delta', content: lastCodeChunk }
                  lastCodeFlushAt = Date.now()
                }
              }
            }
            inCodeBlock = false
            textBuffer = ''
            lastTextFlushAt = Date.now()
            continue
          }

          if (inCodeBlock) {
            if (!suppressCodeTail) {
              const completed = self.extractFirstCompleteHtmlDocument(`${codeBuffer}${textBuffer}`)
              if (completed) {
                finalCode = completed
                suppressCodeTail = true
                yield { type: 'code', content: completed }
                textBuffer = ''
                continue
              }
            }

            if (suppressCodeTail) {
              continue
            }

            const flushed = self.maybeFlushBufferedStreamChunk({
              buffer: textBuffer,
              minChars: STREAM_CODE_MIN_CHARS,
              keepTail: STREAM_CODE_KEEP_TAIL,
              lastFlushAt: lastCodeFlushAt,
            })
            if (flushed) {
              textBuffer = flushed.rest
              codeBuffer += flushed.flush
              yield { type: 'code_delta', content: flushed.flush }
              lastCodeFlushAt = Date.now()
            }
            continue
          }

          if (finalCode) {
            textBuffer = ''
            continue
          }

          const flushed = self.maybeFlushBufferedStreamChunk({
            buffer: textBuffer,
            minChars: STREAM_TEXT_MIN_CHARS,
            keepTail: STREAM_TEXT_KEEP_TAIL,
            lastFlushAt: lastTextFlushAt,
          })
          if (flushed) {
            textBuffer = flushed.rest
            yield { type: 'text', content: flushed.flush }
            lastTextFlushAt = Date.now()
          }
        }
      }

      if (textBuffer) {
        if (inCodeBlock) {
          if (!suppressCodeTail) {
            const completed = self.extractFirstCompleteHtmlDocument(`${codeBuffer}${textBuffer}`)
            if (completed) {
              finalCode = completed
              yield { type: 'code', content: completed }
            } else {
              codeBuffer += textBuffer
              yield { type: 'code_delta', content: textBuffer }
            }
          }
        } else if (!finalCode) {
          yield { type: 'text', content: textBuffer }
        }
      }
    })(this)

    return {
      chunks,
      get fullContent() {
        return fullContent
      },
      get codeBuffer() {
        return codeBuffer
      },
      get codeStartEmitted() {
        return codeStartEmitted
      },
      get finalCode() {
        return finalCode
      },
    }
  }

  private maybeFlushBufferedStreamChunk(params: {
    buffer: string
    minChars: number
    keepTail: number
    lastFlushAt: number
  }): { flush: string; rest: string } | null {
    if (params.buffer.length <= params.keepTail) return null

    const elapsed = Date.now() - params.lastFlushAt
    const reachedLength = params.buffer.length > params.minChars
    const reachedTime = elapsed >= STREAM_FLUSH_INTERVAL_MS
    if (!reachedLength && !reachedTime) return null

    const flush = params.buffer.slice(0, -params.keepTail)
    if (!flush) return null

    return {
      flush,
      rest: params.buffer.slice(-params.keepTail),
    }
  }

  private buildRecoveryStreamPlan(recoveredCode: string, existingCode: string): {
    reset: boolean
    streamCode: string
  } {
    if (existingCode && recoveredCode.startsWith(existingCode)) {
      return {
        reset: false,
        streamCode: recoveredCode.slice(existingCode.length),
      }
    }

    return {
      reset: true,
      streamCode: recoveredCode,
    }
  }

  private async *streamRecoveredHtml(params: {
    recoveredCode: string
    existingCode: string
    codeStartEmitted: boolean
  }): AsyncGenerator<StreamOutputChunk> {
    const plan = this.buildRecoveryStreamPlan(params.recoveredCode, params.existingCode)
    if (!plan.streamCode) return

    if (plan.reset) {
      yield { type: 'code_reset', content: '' }
      if (!params.codeStartEmitted) {
        yield { type: 'code_start', content: '' }
      }
    }

    for (let i = 0; i < plan.streamCode.length; i += RECOVERY_STREAM_CHUNK_SIZE) {
      const chunk = plan.streamCode.slice(i, i + RECOVERY_STREAM_CHUNK_SIZE)
      if (!chunk) continue
      yield { type: 'code_delta', content: chunk }
      if (i + RECOVERY_STREAM_CHUNK_SIZE < plan.streamCode.length) {
        await new Promise((resolve) => setTimeout(resolve, RECOVERY_STREAM_DELAY_MS))
      }
    }
  }

  private buildSystemPrompt(params: { skillDocs: string; skillCatalog?: string; apiContractsPrompt?: string }): string {
    return `你是天地图 JS API v5.0 智能开发助手。你需要根据用户请求自主判断应该做什么。

## 你的能力
1. **生成地图代码**：当用户需要创建/修改地图、可视化数据、搜索地点、规划路线时，生成可运行的 HTML
2. **回答技术问题**：当用户询问 API 用法、概念解释等纯知识性问题时，用文字回答
3. **分析数据文件**：当用户上传文件并询问其内容时，基于文件摘要回答
4. **利用外部工具结果回答**：当系统已提供搜索/抓取结果时，优先基于这些结果回答，不要忽略
5. **总结工程文件修改**：当系统已执行工作区片段编辑时，用中文总结改动与影响，不要输出 HTML，除非用户明确要求生成地图页面

## 自主判断规则
- 如果用户的请求需要在地图上展示任何内容（标注、图层、路线、搜索结果、数据可视化等），生成 HTML 代码
- 如果用户说"修改"、"调整"、"改一下"等，基于现有代码修改并输出新的完整 HTML
- 如果用户询问的是纯知识性问题（如"什么是 GeoJSON"、"这个 API 怎么用"），用文字回答，不生成代码
- 如果用户上传了文件并问"这个数据里面是什么"、"有多少条记录"等分析性问题，基于文件摘要用文字回答
- 如果有现有代码且用户的后续请求含有动作词（如"帮我"、"添加"、"在地图上"），生成修改后的代码
- 如果输入中包含“外部工具结果（高优先级）”，必须优先吸收这些结果再回答
- 如果外部工具结果显示已经修改了工作区文件，默认输出文字总结，不生成 HTML，除非用户明确要求“返回页面代码/地图代码”

## 代码生成规则（仅当你判断需要生成代码时）
1. 命名空间：只使用 TMapGL
2. Token：使用 \${TIANDITU_TOKEN} 占位符
2.2 若代码中出现 TMapGL（包括 new TMapGL.Map / TMapGL.Marker / TMapGL.Popup 等），必须包含天地图 SDK 引入脚本：\`<script src="https://api.tianditu.gov.cn/api/v5/js?tk=\${TIANDITU_TOKEN}"></script>\`
2.1 地图构造函数必须使用天地图 v5 写法：\`new TMapGL.Map('map', { ... })\`，禁止使用 mapbox 风格 \`new TMapGL.Map({ container: 'map', ... })\`
2.3 只能使用当前已加载 reference 文档/示例中已经出现并可直接对照的 TMapGL API；未在 reference 中看到明确示例的 API 不要猜写
2.4 如果当前 reference 没有给出某个能力的明确用法，必须退回到已有示例能覆盖的实现路径；例如没有可靠 Marker 示例时，优先改用 GeoJSON + circle/symbol 图层，不要自行发明覆盖物 API
3. 控件/图层/数据源更新：必须满足“地图 ready + source ready”
3.1 任何 \`map.addSource\`、\`map.addLayer\`、\`map.addControl\`、\`map.fitBounds\`、\`new TMapGL.Marker(...).addTo(map)\`、\`new TMapGL.Popup(...).addTo(map)\`、\`map.setPaintProperty\`、\`map.setLayoutProperty\`、基于图层 ID 的事件绑定（如 \`map.on('click', 'layer-id', ...)\`）默认都必须在 \`map.on("load", ...)\` 之后执行
3.2 远程/文件数据允许在 \`map.on("load")\` 之前发起 fetch；但真正的渲染提交（如 \`map.addSource\` / \`map.addLayer\` / \`map.getSource(...).setData(...)\` / \`map.fitBounds(...)\`）只能在地图 ready 之后执行
3.2.1 \`TMapGL.LngLatBounds\` 没有 \`.isValid()\` 方法；需要自动缩放到数据范围时，必须自行维护 \`hasBoundsPoint\` / \`validBoundsPointCount\`，只有确认至少 extend 过 1 个有效坐标后才能 \`map.fitBounds(bounds, ...)\`
3.3 如果 source 是在 \`map.on("load")\` 里创建的，任何 \`map.getSource('id')\` / \`.setData(...)\` 都必须先确认 source 已存在；可以采用“缓存数据 -> load 后再 apply”或“load 与 fetch 并行，汇合后再 setData”的模式，但不要写成 \`initMap(); loadData();\` 后立刻 \`map.getSource(...).setData(...)\`
3.4 不要写“先 fetch 并 addSource/addLayer，最后才注册 map.on('load')”的时序；这会导致 SDK 内部状态未就绪并触发难以解释的运行时错误
3.4.1 如果需要清理旧图层/旧数据源，不要直接写 \`if (map.getLayer('id')) map.removeLayer('id')\` 或 \`if (map.getSource('id')) map.removeSource('id')\`；必须先确认 \`map\` 实例已存在并且对应方法可用，例如 \`if (map && map.getLayer && map.getLayer('id')) ...\`
3.4.2 如果需要使用 \`map.addLayer(layerDef, beforeId)\` 控制插入顺序，必须先确认 \`beforeId\` 对应图层真实存在：\`if (map && map.getLayer && map.getLayer(beforeId)) map.addLayer(layerDef, beforeId); else map.addLayer(layerDef)\`。不要写死 \`waterway-label\` 之类的底图锚点层名
3.5 图层类型与样式属性必须匹配：\`fill\` 图层只使用 \`fill-*\` 样式，\`line\` 图层只使用 \`line-*\` 样式，\`circle\` 图层只使用 \`circle-*\` 样式
3.6 面边框颜色可以直接用 \`fill-outline-color\`，但边框宽度若需要可调，必须额外新增一个 \`line\` 图层；禁止在 \`fill\` 图层的 paint 中写 \`fill-width\`
3.7 覆盖物强约束：Marker/Popup 必须使用 reference 中出现过的标准链式写法，例如 \`new TMapGL.Marker(...).setLngLat([lng, lat]).addTo(map)\`、\`new TMapGL.Popup(...).setLngLat([lng, lat]).setHTML(html).addTo(map)\`
3.8 禁止生成未经 reference 验证的覆盖物调用：如 \`map.add(marker)\`、\`map.add(popup)\`、\`new TMapGL.Marker({ position, icon })\`、\`marker.setIcon(...)\`、\`popup.setElement(...)\`
4. 坐标格式：[经度, 纬度]
5. 输出：完整可运行 HTML 文件
6. 中文注释
7. 默认底图时不要显式设置 \`style\`（不要写 \`style: 'default'\`）
8. 天地图 JS API v5 个性化底图优先使用 \`styleId\`；当前已验证命名值为 \`'normal'\` / \`'black'\` / \`'blue'\`
8.1 不要把命名样式误写到 \`style\` 字段里，例如 \`style: 'black'\` / \`style: 'blue'\` / \`style: 'default'\`；这会在当前运行容器里触发底图 404 或 \`Failed to parse URL from black/blue\`
8.2 如果只是想要更深色或更有设计感的页面，除了 \`styleId\` 之外，也可以通过页面背景、面板、图例、遮罩和图层配色增强视觉效果
8.2 如果用户明确要卫星或地形底图，使用 \`mapType: 'image'\` 或 \`mapType: 'terrain'\`
8.3 禁止生成 mapbox://、自造 style URL，或任何未经当前 reference 明确验证的 style 配置
8.4 如果使用 \`['geometry-type']\` 过滤 GeoJSON 几何类型，统一使用单类型名：\`'Point' | 'LineString' | 'Polygon'\`；不要写 \`MultiPoint\` / \`MultiLineString\` / \`MultiPolygon\`
8.5 如果运行时文件契约或自动数据理解已经明确数据源全是 \`Polygon/MultiPolygon\`，优先直接不写几何类型 \`filter\`；若必须写，使用 \`['==', ['geometry-type'], 'Polygon']\`
8.6 根据名称/ID 列表高亮 GeoJSON 要素时，禁止在图层 filter 中写 \`['in', ['get', 'name'], 'literal', list]\`、\`['in', ['get', 'name'], ['literal', list]]\` 或直接引用 JS 数组变量；当前天地图 SDK 容易报 \`Expected 2 arguments, but found 3\`。必须先遍历 features 写入布尔字段，例如 \`feature.properties.__highlight = list.indexOf(feature.properties.name) !== -1\`，再使用 \`filter: ['==', ['get', '__highlight'], true]\`；反选使用 \`['!=', ['get', '__highlight'], true]\`，或拆成两个 FeatureCollection source
9. 地图实例变量统一使用 \`var map\`，禁止在同一 HTML 中重复 \`let/const map\` 声明（避免 "Identifier 'map' has already been declared"）
10. 默认不要添加 \`symbol + text-field\` 的常驻文字标注图层（容易触发字体 pbf 请求告警）；优先用侧边栏/弹窗展示文字信息。仅当用户明确要求“地图上常驻文字标注”时才添加文本图层
10.1 如果确实需要 \`symbol + text-field\` 文本图层，必须显式设置 \`'text-font': ['WenQuanYi Micro Hei Mono']\`，不要依赖默认字体栈；默认字体栈可能请求 \`Open Sans Regular,Arial Unicode MS Regular\` 并触发字体 pbf 404
11. POI/地名搜索强约束：
   - 只能调用 GET /api/tianditu/search（query string 传参）
   - 禁止调用 https://api.tianditu.gov.cn/v2/search 或 https://api.tianditu.gov.cn/search/v1/poi
   - 禁止 POST + body(postStr) 调 /api/tianditu/search
   - URL 必须使用绝对地址：new URL('/api/tianditu/search', window.location.origin).toString()
   - 新代码优先沿用官方字段名：keyWord、queryType、level、mapBound、pointLonlat、queryRadius、polygon、specify、dataTypes、show
   - 新代码必须显式传 queryType，不要默认写 keyword、type=nearby/view/polygon/category/stats/admin-area、lng/lat/radius 这类兼容别名
   - queryType=13（分类搜索）新代码显式传 mapBound，不要依赖代理默认值
   - 读取结果前必须先解包代理层：payload.success===true 后使用 payload.data（不可直接把 payload 当 result）
   - 业务字段必须从 data 读取：Number(data.resultType)、data.pois、data.status.infocode
   - queryType=13 若一次请求多个 dataTypes，要兼容“标准 resultType 外壳”和“按分类名分组对象”两种返回结构
   - data.pois[*].distance 是字符串（如 319m/1.1km），不要默认按数字除以 1000
11.1 路线规划的软引导：
   - 如果起终点来自地点名、机构名或详细地址，而不是用户明确给出的经纬度，优先先调用 /api/tianditu/geocode 获取真实坐标，再调用 /api/tianditu/drive 或 /api/tianditu/transit
   - 对“国家基础地理信息中心到自然资源部”“故宫到首都机场”这类命名地点路线，不要凭印象手写起终点坐标
   - 只有当用户已经明确提供 [lng, lat] 或 “经度,纬度” 时，才直接把坐标传给路线规划接口

## 数据文件处理规则（极其重要，必须严格遵守）
当用户上传了数据文件时：
- 用户上传的文件信息中包含"文件获取链接URL"字段（可能是完整 URL）
- 如果文件上下文中包含 \`## 运行时文件契约（唯一可信，代码必须只按本节读取）\`，你只能遵循这一个契约区块
- 如果文件上下文中包含 \`## 自动数据理解结果（系统已读取真实文件，高优先级）\`，优先相信其中的几何类型、字段画像、坐标提取和可视化建议
- \`## 原始来源附注\` 仅供溯源，禁止把其中的原始包装结构当作运行时代码读取路径
- 你**必须原封不动地使用该 URL 路径**，不得修改、缩写或自编文件名
- 在生成的代码中使用 fetch() 加载该 URL，不要将数据硬编码在代码中
- 若运行时文件契约声明 \`responseShape = FeatureCollection\` 且 \`geojsonPath = rawData\`，则 fetch(url).json() 的结果可直接作为 GeoJSON 使用
- 若运行时文件契约声明 \`kind = json\` 且 \`responseShape = object\`，fetch(url).json() 的结果是对象根；禁止生成 \`rawData[0]\` / \`data[0]\`
- 若运行时文件契约声明 \`kind = json\` 且 \`responseShape = array\`，fetch(url).json() 的结果是数组根；禁止直接假设 \`rawData.someKey\`
- 若运行时文件契约提供了 \`canonicalAccess\`，必须优先直接使用这些访问方式；不要凭空发明“第一支队伍/第二支队伍/队伍列表”等别名字段
- 若运行时文件契约提供了 \`forbiddenPaths\`，这些路径禁止出现在代码里（例如 rawData.data / rawData.rawData）
- 若运行时文件契约提供了 \`forbiddenPatterns\`，这些访问模式禁止出现在代码里（例如对象根时的 rawData[0]）
- 若文件上下文中提供了 "GeoJSON提取路径"，必须按该路径提取 GeoJSON，且不能自行追加包装层
- \`coordinatesPreview\` 仅用于文件预览展示，运行时代码禁止使用该字段；运行时统一读取 \`geometry.coordinates\`
- 如果需要做热力图、统计、筛选、列表渲染，可以遍历 FeatureCollection.features
- 传给 map.addSource({ type: 'geojson', data }) 的 data 必须是 FeatureCollection/Feature 对象
- 禁止把 geojson.features（数组）直接传给 map.addSource 的 data
- 如果自动数据理解结果已经识别出坐标字段（如 \`item["地点坐标"] -> [lng, lat]\`），必须按该字段读取，不要改写成 \`event.coordinates\`、\`item.coord\` 等猜测名
- ❌ 错误示范：fetch('/uploads/us-airports.geojson') ← 自编文件名，绝对禁止
- ✅ 正确做法：从用户上传文件信息的"文件获取链接URL"字段中复制完整路径直接使用

## API 引入
\`\`\`html
<script src="https://api.tianditu.gov.cn/api/v5/js?tk=\${TIANDITU_TOKEN}"></script>
\`\`\`

## 参考文档
${params.skillDocs}

${params.apiContractsPrompt ? `## 天地图接口契约（高优先级）\n${params.apiContractsPrompt}\n` : ''}

${params.skillCatalog ? '## 可用文档目录\n' + params.skillCatalog : ''}

## 输出格式
- 如果生成代码：可以先简要说明思路，然后输出且只输出一个 \`\`\`html 代码块
- 代码块必须从 \`<!DOCTYPE html>\` 或 \`<html>\` 开始，在 \`</html>\` 后立即闭合 Markdown 代码围栏，并立刻停止输出
- 禁止在代码块之后继续输出任何解释、补充说明、代码片段或注释
- 如果纯文字回答：直接用中文回答，简洁准确，不要输出 \`\`\`html 代码块`
  }

  private buildFixSystemPrompt(params: { skillDocs: string; apiContractsPrompt?: string }): string {
    return `你是天地图 JS API v5.0 代码修复专家。修复用户代码中的错误。

## 修复规则
1. 只修复报错的部分，保持其他代码不变
2. 必须使用 TMapGL 命名空间
3. 输出完整的可运行 HTML
4. 优先修复真正导致报错的根因，避免大幅重写
5. 如果是异步加载/事件时序问题，要增加必要的判空和时机保护
5.1 如果提供了“错误诊断”信息，必须先遵循诊断中的根因与检查清单再改代码
5.2 对地图渲染时序，优先检查是否在 \`map.on("load")\` 之前调用了 \`map.addSource\` / \`map.addLayer\` / \`map.addControl\` / \`map.fitBounds\`，以及是否在 source 未创建时就直接 \`map.getSource(...).setData(...)\`
5.2.3 如果错误包含 \`isValid is not a function\` 且代码中使用了 \`TMapGL.LngLatBounds\`，优先检查是否误写了 \`bounds.isValid()\`；修复时应改为“有效坐标标记/计数器 + 条件性 \`fitBounds\`”，不要继续沿用其他地图 SDK 的 Bounds API 习惯
5.2.1 如果代码需要清理旧图层/旧 source，先检查是否在 \`map\` 可能尚未初始化时直接调用了 \`map.getLayer(...)\` / \`map.getSource(...)\` / \`map.removeLayer(...)\` / \`map.removeSource(...)\`
5.2.2 如果错误包含 \`Cannot add layer "... before non-existing layer ..."\`，优先检查是否把 \`map.addLayer(layerDef, beforeId)\` 的 \`beforeId\` 写死成了不存在的底图图层（如 \`waterway-label\`）；修复时必须先 \`map.getLayer(beforeId)\` 再决定是否传第二个参数
5.3 修复时只能使用当前已加载 reference 文档中已经明确出现的 TMapGL API；没有示例支撑的 API 不要猜写
5.4 如果当前 reference 没有覆盖某个 API 能力，优先改成已有示例能完成的实现，不要硬修成另一个未经验证的写法
6. 若错误涉及 GeoJSON/数据格式（如 "not a valid GeoJSON object"、"无法识别的数据格式"）：
   - 优先检查是否严格遵循了“运行时文件契约（唯一可信）”中的 geojsonPath 与 forbiddenPaths
   - 优先检查传给 map.addSource 的 data 是否误传成 features 数组
   - 如果业务上需要做热力图/列表/统计，允许遍历 FeatureCollection.features；问题通常出在把 features 数组误传给 addSource，而不是遍历本身
   - 在确认结构/入参无误前，不要优先归因到坐标系问题
7. 如果文件上下文包含“运行时文件契约（唯一可信）”，修复时必须优先遵循该契约；禁止根据“原始来源附注”猜测 rawData.data / rawData.rawData 等额外包装层
7.1 如果运行时文件契约是 \`kind=json\`：
   - 对象根时优先检查是否误写成 \`rawData[0]\` / \`data[0]\`
   - 数组根时优先检查是否误写成 \`rawData.someKey\`
   - 必须优先采用 canonicalAccess 中已经给出的真实访问方式
7.2 如果文件上下文包含“自动数据理解结果（系统已读取真实文件，高优先级）”，修复时优先遵循其中的 geometry 类型、字段画像和安全坐标提取方式
7.3 如果错误是 \`Cannot read properties of undefined (reading '...')\`，优先检查根结构、顶层 key 和字段路径是否与运行时契约一致，不要自由猜测字段名
7.4 如果错误来自天地图 SDK 内部（如 \`js?tk=...:32\`）且没有明确业务字段名，优先排查地图/source ready 时序：图层、控件和 fitBounds 是否在 \`map.on("load")\` 之前执行，以及 \`map.getSource(...).setData(...)\` 是否发生在 source 尚未创建时
7.4.1 如果错误表现为 \`Cannot read properties of undefined (reading 'getLayer')\` / \`'getSource'\`，优先检查是否在清理旧图层/旧 source 时漏掉了 \`map\` 判空与方法存在性校验
7.4.2 如果错误表现为 \`Cannot add layer "... before non-existing layer ..."\`，优先删除或守卫 \`map.addLayer(..., beforeId)\` 的固定锚点层；只有在 \`map.getLayer(beforeId)\` 为真时才传 \`beforeId\`
7.5 如果错误发生在 \`map.addLayer\` 附近或表现为 SDK 内部属性读取异常，优先检查图层类型与 \`paint/layout\` 属性是否匹配；例如 \`fill\` 图层不能使用 \`fill-width\`，若要可调边框宽度应新增 \`line\` 图层
8. 如果错误包含 "AJAXError: Not Found (404): default"、"Failed to parse URL from black" 或 "Failed to parse URL from blue"，优先检查是否把 v5 个性化底图字段 \`styleId\` 误写成了 \`style\`；应改为 \`styleId: 'black' | 'blue' | 'normal'\`，默认底图也可直接省略 \`styleId\`
8.1 如果 GeoJSON source 已成功加载、图层也创建成功，但面/线/点完全不显示，优先检查 \`['geometry-type']\` 过滤条件是否误写成 \`MultiPolygon\` / \`MultiLineString\` / \`MultiPoint\`；当前运行环境应改用 \`Polygon\` / \`LineString\` / \`Point\`
8.1.1 如果点专题图 / 热力图 / 聚合图的原始数据里出现 \`MultiPoint\`，不要直接把 \`MultiPoint\` 原样传给 \`cluster\` / \`heatmap\` / \`circle\` 图层；修复时应先归一化成 \`Point FeatureCollection\`
8.1.2 如果错误包含 \`Expected 2 arguments, but found 3\`，优先检查图层 filter 是否写了 \`['in', ['get', field], 'literal', list]\` 或 \`['in', ['get', field], ['literal', list]]\`。修复时不要继续在 filter 中传数组变量；先给每个 feature 写入 \`properties.__highlight\` 之类的布尔字段，再用 \`['==', ['get', '__highlight'], true]\` 过滤
8.2 如果界面一直停在“正在处理 N/M”或某个批量地理编码序列卡在第一条，优先检查是否在地图 \`load\` 完成前就启动了 geocode，并在 geocode 回调里立刻 \`addTo(map)\` / \`flyTo\` / \`fitBounds\`；修复时应把批量流程移到 \`map.on("load", ...)\` 后再启动
9. 如果错误包含 "Identifier 'map' has already been declared"：
   - 检查是否存在重复 \`let/const map\` 声明
   - 统一改为单次声明或改为 \`var map\`
   - 不要在同一 HTML 的多个脚本块中重复声明 \`let/const map\`
10. 如果错误是 \`vector.tianditu.gov.cn/static/font/*.pbf\` 的 404：
   - 这通常是字体资源请求告警，不一定影响地图主体功能
   - 优先避免新增 \`symbol + text-field\` 常驻文字图层，改为侧边栏/弹窗展示文字
   - 如果业务上必须保留常驻文字标注，给文本图层显式补上 \`'text-font': ['WenQuanYi Micro Hei Mono']\`，不要依赖默认字体栈
   - 不要因为该告警去重写核心业务逻辑（先确认地图主体与交互是否正常）
11. 如果报错包含 \`TMapGL is not defined\`：
   - 先检查并补齐天地图 SDK 引入：
     \`<script src="https://api.tianditu.gov.cn/api/v5/js?tk=\${TIANDITU_TOKEN}"></script>\`
   - 确保该脚本位于业务脚本之前执行
11.1 如果报错包含 \`map.add is not a function\`、\`setIcon is not a function\`、\`setElement is not a function\` 或代码里出现 \`map.add(marker)\` / \`popup.setElement(...)\`：
   - 优先判断是否混入了其他地图 SDK 的覆盖物 API
   - Marker/Popup 必须回到 reference 示例中的链式写法：\`new TMapGL.Marker(...).setLngLat([lng, lat]).addTo(map)\` / \`new TMapGL.Popup(...).setLngLat([lng, lat]).setHTML(html).addTo(map)\`
   - 禁止继续使用 \`map.add(marker)\`、\`map.add(popup)\`、\`new TMapGL.Marker({ position, icon })\`、\`marker.setIcon(...)\`、\`popup.setElement(...)\`
12. 如果是 POI/地名搜索错误：
   - 禁止改成直连官方搜索端点；必须回到 GET /api/tianditu/search 代理契约
   - 禁止把代理搜索改为 POST + body(postStr)；必须改成 query string
   - 优先检查参数名和 queryType 是否回到了官方语义：keyWord / queryType / mapBound / pointLonlat / queryRadius / polygon / specify / dataTypes
   - 检查是否漏掉代理层解包：必须先判 payload.success，再从 payload.data 读取 resultType/pois/status
   - 如果是 queryType=13，多分类结果要检查是否误按单一 data.pois 解析，必要时兼容分类分组对象
   - 检查 distance 展示：若来自天地图周边搜索，distance 为字符串（m/km），不要强行数值计算
13. 如果是路线规划相关错误且起终点看起来是地点名、机构名或地址：
   - 优先回看是否漏了地理编码这一步
   - 若代码里直接写死 startCoords / endCoords 之类的估计坐标，优先改为先 geocode 再 drive/transit
   - 只有在用户明确给出坐标时，才保留直接传坐标的实现

## 参考文档
${params.skillDocs}

${params.apiContractsPrompt ? `\n## 天地图接口契约（高优先级）\n${params.apiContractsPrompt}` : ''}`
  }

  private buildFixPatchSystemPrompt(params: { skillDocs: string; apiContractsPrompt?: string }): string {
    return `你是天地图 JS API v5.0 代码修复专家。你的首选任务是对现有 HTML 做最小局部 patch，而不是重写整页。

## 局部 patch 协议
1. 可以先用 1-2 句中文说明修复思路；如果已经在重试，或你已经明确知道改哪几行，也可以直接从 SEARCH/REPLACE blocks 开始。
2. 然后只输出一个或多个 SEARCH/REPLACE blocks：
------- SEARCH
[精确查找片段]
=======
[替换后的新片段]
++++++ REPLACE
3. 每个 SEARCH 必须尽量短小，但又足够唯一。
4. 严禁输出完整 HTML、整页重写块、额外 Markdown 标题、JSON 或解释性清单。
5. 如果需要多处修改，按文件出现顺序输出多个 block。
6. 允许删除代码：REPLACE 部分留空。
7. 禁止空 SEARCH，禁止“把整个 <html>...</html> 全部放进 SEARCH”。
8. 如果上一轮只是协议失败（没有输出出可解析的 patch blocks），这不代表要整页重写；你必须改为返回合规 patch blocks。

## patch 设计要求
- 只修改真正导致报错的最小代码片段。
- 优先保持页面布局、样式、交互和数据流不变。
- 如果提供了错误诊断，必须先遵循诊断中的根因与检查清单。
- 如果 reference 或接口契约已经给出正确写法，必须优先回到这些写法。
- 如果某个修改会影响多处重复代码，优先只改出错路径，不要顺手大改其它无关区域。
- 如果一段旧代码可能命中多处，必须扩充上下文直到唯一，不要赌“默认第一个”。

## 参考文档
${params.skillDocs}

${params.apiContractsPrompt ? `\n## 天地图接口契约（高优先级）\n${params.apiContractsPrompt}` : ''}`
  }

  private buildGeneratePatchSystemPrompt(params: { skillDocs: string; skillCatalog?: string; apiContractsPrompt?: string }): string {
    return `你是天地图 JS API v5.0 前端改版专家。当前任务是基于现有 HTML 满足新的需求变更。你的首选任务是对现有 HTML 做最小局部 patch，而不是重写整页。

## 局部 patch 协议
1. 可以先用 1-2 句中文说明将要怎么改；如果已经非常明确，也可以直接从 SEARCH/REPLACE blocks 开始。
2. 然后只输出一个或多个 SEARCH/REPLACE blocks：
------- SEARCH
[精确查找片段]
=======
[替换后的新片段]
++++++ REPLACE
3. 每个 SEARCH 必须尽量短小，但又足够唯一。
4. 严禁输出完整 HTML、整页重写块、额外 Markdown 标题、JSON 或解释性清单。
5. 如果需要多处修改，按文件出现顺序输出多个 block。
6. 允许删除代码：REPLACE 部分留空。
7. 禁止空 SEARCH，禁止“把整个 <html>...</html> 全部放进 SEARCH”。
8. 如果上一轮只是协议失败（没有输出出可解析的 patch blocks），这不代表要整页重写；你必须改为返回合规 patch blocks。

## patch 设计要求
- 只修改满足用户新需求所必需的最小代码片段。
- 优先保持当前页面的布局、数据流、地图初始化和正常工作的交互不变。
- 如果用户只是要求调整颜色、文案、图例、图标、控件、侧边栏样式或局部交互，不要顺手重写整个页面结构。
- 如果某个修改会影响多处重复代码，优先只改用户这次明确提到的区域。
- 如果一段旧代码可能命中多处，必须扩充上下文直到唯一，不要赌“默认第一个”。
- 如果已有实现已经正确工作，只需要围绕用户这次的新要求做最小差异修改。

## 可用能力目录
${params.skillCatalog || '（未提供能力目录）'}

## 参考文档
${params.skillDocs}

${params.apiContractsPrompt ? `\n## 天地图接口契约（高优先级）\n${params.apiContractsPrompt}` : ''}`
  }

  private buildFixUserPrompt(params: {
    code: string
    error: string
    skillDocs: string
    fileData?: string
    errorDiagnosis?: string
  }): string {
    let prompt = `## 当前代码
\`\`\`html
${params.code}
\`\`\`

## 错误信息
${params.error}

请修复以上错误，并只输出修复后的完整 HTML 代码。
- 如果使用 Markdown 代码块，必须在 </html> 后立即闭合代码围栏
- 禁止在 </html> 后继续输出任何补充代码、注释或解释`

    if (params.errorDiagnosis) {
      prompt += `\n\n## 错误诊断（必须先按此定位根因再修改）\n${params.errorDiagnosis}`
    }

    if (params.fileData) {
      prompt += `\n\n## 用户数据文件的运行时契约与样例（高优先级）\n${params.fileData}`
    }

    return prompt
  }

  private buildFixPatchUserPrompt(params: {
    code: string
    error: string
    fileData?: string
    errorDiagnosis?: string
  }): string {
    let prompt = `## 当前代码
\`\`\`html
${params.code}
\`\`\`

## 错误信息
${params.error}

请先给出简短修复思路，然后只输出 SEARCH/REPLACE blocks，不要输出完整 HTML。`

    if (params.errorDiagnosis) {
      prompt += `\n\n## 错误诊断（高优先级）\n${params.errorDiagnosis}`
    }

    if (params.fileData) {
      prompt += `\n\n## 用户数据文件的运行时契约与样例（高优先级）\n${params.fileData}`
    }

    return prompt
  }

  private buildFixPatchRetryUserPrompt(params: {
    code: string
    error: string
    errorDiagnosis?: string
    failedReports: PatchBlockReport[]
    fileData?: string
  }): string {
    const hadProtocolFailure = params.failedReports.some((report) =>
      report.message.includes('没有输出任何可解析的 SEARCH/REPLACE blocks'),
    )
    const failureReport = params.failedReports
      .map((report) => [
        `### 失败块 ${report.blockIndex + 1}`,
        `- 原因: ${report.message}`,
        `- SEARCH 片段:`,
        report.searchPreview || '（空）',
        report.nearbyContext ? `- 附近代码:\n${report.nearbyContext}` : '',
      ].filter(Boolean).join('\n'))
      .join('\n\n')

    let prompt = `## 当前代码（已应用成功 patch 后的最新版本）
\`\`\`html
${params.code}
\`\`\`

## 仍待修复的错误
${params.error}

## 上一轮失败块报告
${failureReport}

请只重发这些失败块对应的 SEARCH/REPLACE blocks。
- 不要重复已经成功的 patch
- 不要输出完整 HTML
- 每个 SEARCH 必须唯一命中`

    if (hadProtocolFailure) {
      prompt += `\n- 你上一轮没有输出任何可解析的 SEARCH/REPLACE blocks，这只是协议失败，不代表必须整页重写
- 这一轮请不要输出前言、总结、Markdown 代码围栏或完整 HTML
- 这一轮的第一行必须直接从 \`------- SEARCH\` 或 \`<<<<<<< SEARCH\` 开始`
    }

    if (params.errorDiagnosis) {
      prompt += `\n\n## 错误诊断（高优先级）\n${params.errorDiagnosis}`
    }

    if (params.fileData) {
      prompt += `\n\n## 用户数据文件的运行时契约与样例（高优先级）\n${params.fileData}`
    }

    return prompt
  }

  private buildGeneratePatchRetryUserPrompt(params: {
    code: string
    userInput: string
    conversationHistory?: string
    failedReports: PatchBlockReport[]
    fileData?: string
    toolContext?: string
  }): string {
    const hadProtocolFailure = params.failedReports.some((report) =>
      report.message.includes('没有输出任何可解析的 SEARCH/REPLACE blocks'),
    )
    const failureReport = params.failedReports
      .map((report) => [
        `### 失败块 ${report.blockIndex + 1}`,
        `- 原因: ${report.message}`,
        `- SEARCH 片段:`,
        report.searchPreview || '（空）',
        report.nearbyContext ? `- 附近代码:\n${report.nearbyContext}` : '',
      ].filter(Boolean).join('\n'))
      .join('\n\n')

    let prompt = `## 当前代码（已应用成功 patch 后的最新版本）
\`\`\`html
${params.code}
\`\`\`

## 当前需求
${params.userInput}

## 上一轮失败块报告
${failureReport}

请只重发这些失败块对应的 SEARCH/REPLACE blocks。
- 不要重复已经成功的 patch
- 不要输出完整 HTML
- 每个 SEARCH 必须唯一命中`

    if (params.conversationHistory) {
      prompt = `## 对话历史\n${params.conversationHistory}\n\n${prompt}`
    }

    if (hadProtocolFailure) {
      prompt += `\n- 你上一轮没有输出任何可解析的 SEARCH/REPLACE blocks，这只是协议失败，不代表必须整页重写
- 这一轮请不要输出前言、总结、Markdown 代码围栏或完整 HTML
- 这一轮的第一行必须直接从 \`------- SEARCH\` 或 \`<<<<<<< SEARCH\` 开始`
    }

    if (params.fileData) {
      prompt += `\n\n## 用户数据文件的运行时契约与样例（高优先级）\n${params.fileData}`
    }

    if (params.toolContext) {
      prompt += `\n\n${params.toolContext}`
    }

    return prompt
  }

  private buildUserPrompt(params: {
    userInput: string
    conversationHistory?: string
    existingCode?: string
    fileData?: string
    toolContext?: string
  }): string {
    let prompt = params.userInput

    if (params.existingCode) {
      prompt += `\n\n## 当前代码（需要在此基础上修改）\n\`\`\`html\n${params.existingCode}\n\`\`\``
    }

    if (params.fileData) {
      prompt += `\n\n## 用户数据文件的运行时契约与样例（高优先级）\n${params.fileData}`
    }

    if (params.toolContext) {
      prompt += `\n\n${params.toolContext}`
    }

    if (params.conversationHistory) {
      prompt = `## 对话历史\n${params.conversationHistory}\n\n## 当前请求\n${prompt}`
    }

    return prompt
  }

  private buildGeneratePatchUserPrompt(params: {
    userInput: string
    conversationHistory?: string
    existingCode: string
    fileData?: string
    toolContext?: string
  }): string {
    let prompt = `## 当前需求
${params.userInput}

## 当前代码
\`\`\`html
${params.existingCode}
\`\`\`

请先给出简短修改思路，然后只输出 SEARCH/REPLACE blocks，不要输出完整 HTML。`

    if (params.fileData) {
      prompt += `\n\n## 用户数据文件的运行时契约与样例（高优先级）\n${params.fileData}`
    }

    if (params.toolContext) {
      prompt += `\n\n${params.toolContext}`
    }

    if (params.conversationHistory) {
      prompt = `## 对话历史\n${params.conversationHistory}\n\n${prompt}`
    }

    return prompt
  }

  private recoverCodeFromCodeDelta(codeDelta: string): string {
    const normalized = codeDelta
      .replace(/^```html\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim()

    if (!normalized) return ''
    if (!/(<!doctype\s+html|<html\b)/i.test(normalized)) return ''
    return this.finalizeHtmlCandidate(normalized)
  }

  private finalizeHtmlCandidate(code: string): string {
    return this.extractFirstCompleteHtmlDocument(code.trim())
  }

  private isLikelyCompleteHtmlDocument(code: string): boolean {
    const normalized = code.trim()
    if (!normalized) return false
    if (!/(<!doctype\s+html|<html\b)/i.test(normalized)) return false
    if (!/<\/html>\s*$/i.test(normalized)) return false
    if (/<body\b/i.test(normalized) && !/<\/body>/i.test(normalized)) return false
    if (!this.hasBalancedTagPairs(normalized, 'script')) return false
    if (!this.hasBalancedTagPairs(normalized, 'style')) return false
    if (!this.canParseEmbeddedJavaScript(normalized)) return false
    return true
  }

  private extractFirstCompleteHtmlDocument(code: string): string {
    const start = this.findHtmlDocumentStart(code)
    if (start < 0) return ''

    const htmlSlice = code.slice(start)
    const endMatches = htmlSlice.matchAll(/<\/html>/gi)
    for (const match of endMatches) {
      if (match.index == null) continue
      const candidate = htmlSlice.slice(0, match.index + match[0].length).trim()
      if (this.isLikelyCompleteHtmlDocument(candidate)) {
        return candidate
      }
    }

    return ''
  }

  private hasBalancedTagPairs(code: string, tagName: string): boolean {
    const openCount = (code.match(new RegExp(`<${tagName}\\b`, 'gi')) || []).length
    const closeCount = (code.match(new RegExp(`</${tagName}>`, 'gi')) || []).length
    return openCount === closeCount
  }

  private canParseEmbeddedJavaScript(code: string): boolean {
    if (!this.hasBalancedTagPairs(code, 'script')) return false

    const scriptMatches = [...code.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    return scriptMatches.every((match) => this.isParsableJavaScript(match[1] || ''))
  }

  private isParsableJavaScript(source: string): boolean {
    const script = String(source || '').trim()
    if (!script) return true

    try {
      // Parse only, do not execute. This avoids false negatives on regex
      // literals, replacement maps, and URLs inside strings.
      // eslint-disable-next-line no-new-func
      new Function(script)
      return true
    } catch {
      return false
    }
  }

  private findHtmlDocumentStart(content: string): number {
    const docTypeIndex = content.search(/<!doctype\s+html/i)
    const htmlIndex = content.search(/<html\b/i)
    const starts = [docTypeIndex, htmlIndex].filter((idx) => idx >= 0)
    if (!starts.length) return -1
    return Math.min(...starts)
  }

  private async retryCompleteHtml(params: {
    systemPrompt: string
    userPrompt: string
  }): Promise<{ code: string; explanation: string }> {
    const maxRounds = Math.max(0, config.llm.recoveryRounds || 0)
    if (maxRounds === 0) return { code: '', explanation: '' }

    let lastExplanation = ''

    for (let i = 0; i < maxRounds; i += 1) {
      const llm = createLLM({ temperature: 0.2 })
      const retryPrompt = [
        params.userPrompt,
        '',
        '## 系统续写要求（必须遵守）',
        '你上一条响应在代码中途结束。请重新输出“完整可运行 HTML”。',
        '- 只输出 HTML 代码本身，不要解释',
        '- 从 <!DOCTYPE html> 开始，到 </html> 结束',
        '- 不要使用 Markdown 代码块包裹',
        '- 在保证需求的前提下尽量精简样式和冗余文案',
      ].join('\n')

      const response = await llm.invoke([
        new SystemMessage(params.systemPrompt),
        new HumanMessage(retryPrompt),
      ])

      const content = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content)
      const parsed = this.parseResponse(content)
      if (parsed.code) {
        return {
          code: parsed.code,
          explanation: '检测到上一次输出被截断，已自动完成一轮续写并恢复完整代码。',
        }
      }
      lastExplanation = parsed.explanation || ''
    }

    return { code: '', explanation: lastExplanation }
  }

  private retryCompleteHtmlStream(params: {
    systemPrompt: string
    userPrompt: string
    existingCode: string
    codeStartEmitted: boolean
  }): {
    chunks: AsyncGenerator<StreamOutputChunk>
    code: string
    explanation: string
  } {
    const maxRounds = Math.max(0, config.llm.recoveryRounds || 0)
    let finalCode = ''
    let finalExplanation = ''

    const chunks = (async function* (self: CodeGenerator): AsyncGenerator<StreamOutputChunk> {
      if (maxRounds === 0) return

      for (let i = 0; i < maxRounds; i += 1) {
        const llm = createLLM({ temperature: 0.2 })
        const retryPrompt = [
          params.userPrompt,
          '',
          '## 系统续写要求（必须遵守）',
          '你上一条响应在代码中途结束。请只输出当前 HTML 缺失的后续代码，从当前末尾继续往下写。',
          '- 不要从头重写完整 HTML',
          '- 不要重复已经输出过的前缀',
          '- 不要输出任何解释、前言或总结',
          '- 不要使用 Markdown 代码块包裹',
          '- 续写完成后，必须能与现有前缀拼成完整可运行 HTML',
          '',
          '## 已经成功输出的 HTML 前缀（禁止重复）',
          params.existingCode,
        ].join('\n')

        const stream = await llm.stream([
          new SystemMessage(params.systemPrompt),
          new HumanMessage(retryPrompt),
        ])

        let rawContent = ''
        let emittedLength = 0
        let resetMode = false
        let startEmitted = params.codeStartEmitted

        for await (const chunk of stream) {
          const text = typeof chunk.content === 'string' ? chunk.content : ''
          if (!text) continue

          rawContent += text

          const normalized = self.normalizeRecoveryContinuation(rawContent)
          const shouldReset = /^(<!doctype\s+html|<html\b)/i.test(normalized.trimStart())
          if (shouldReset && !resetMode) {
            resetMode = true
            emittedLength = 0
            yield { type: 'code_reset', content: '' }
            if (!startEmitted) {
              yield { type: 'code_start', content: '' }
              startEmitted = true
            }
          }

          const nextChunk = normalized.slice(emittedLength)
          if (!nextChunk) continue
          emittedLength = normalized.length
          yield { type: 'code_delta', content: nextChunk }
        }

        const normalized = self.normalizeRecoveryContinuation(rawContent).trim()
        const candidate = /^(<!doctype\s+html|<html\b)/i.test(normalized)
          ? normalized
          : `${params.existingCode}${normalized}`
        const finalized = self.finalizeHtmlCandidate(candidate)
        if (finalized) {
          finalCode = finalized
          finalExplanation = '检测到上一次输出被截断，已自动进入流式续写并恢复完整代码。'
          return
        }
      }
    })(this)

    return {
      chunks,
      get code() {
        return finalCode
      },
      get explanation() {
        return finalExplanation
      },
    }
  }

  private normalizeRecoveryContinuation(raw: string): string {
    const normalized = raw
      .replace(/^\uFEFF/, '')
      .replace(/^```html\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')

    const htmlStart = this.findHtmlDocumentStart(normalized)
    if (htmlStart > 0) {
      return normalized.slice(htmlStart)
    }

    return normalized
  }

  private parseResponse(content: string): { code: string; explanation: string } {
    // 提取 HTML 代码块
    const htmlMatch = content.match(/```html\s*([\s\S]*?)```/)
    if (htmlMatch) {
      const code = this.postProcessGeneratedHtml(htmlMatch[1].trim())
      const explanation = content.replace(htmlMatch[0], '').trim()
      if (code) return { code, explanation }
    }

    const htmlStart = this.findHtmlDocumentStart(content)
    if (htmlStart >= 0) {
      const explanation = content.slice(0, htmlStart).trim()
      const code = this.postProcessGeneratedHtml(content.slice(htmlStart).trim())
      if (code) return { code, explanation }
    }

    return { code: '', explanation: content.trim() }
  }

  /**
   * 生成代码兜底规范化（非语义）：
   * 仅做 HTML 闭合与空白清理，不再偷偷修改业务语义。
   */
  private postProcessGeneratedHtml(code: string): string {
    if (!code) return code

    return this.finalizeHtmlCandidate(code.trim())
  }

  /**
   * 搜索代理契约兜底修复（确定性）：
   * - 统一使用绝对代理 URL
   * - 将常见的 POST body(postStr) 写法改为 GET query string
   */
  private enforceSearchProxyContract(code: string): string {
    let next = code

    next = next
      .replace(
        /\b(var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*['"]\/api\/tianditu\/search['"]\s*;/g,
        `$1 $2 = new URL('/api/tianditu/search', window.location.origin).toString();`,
      )
      .replace(
        /\b(var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*['"]\/api\/tianditu\/search\?['"]\s*\+\s*/g,
        `$1 $2 = new URL('/api/tianditu/search', window.location.origin).toString() + '?' + `,
      )
      .replace(
        /\b(var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*['"]\/api\/tianditu\/search['"]\s*\+\s*/g,
        `$1 $2 = new URL('/api/tianditu/search', window.location.origin).toString() + `,
      )
      .replace(
        /fetch\s*\(\s*['"]\/api\/tianditu\/search['"]/g,
        `fetch(new URL('/api/tianditu/search', window.location.origin).toString()`,
      )
      .replace(
        /fetch\s*\(\s*['"]\/api\/tianditu\/search\?['"]\s*\+\s*/g,
        `fetch(new URL('/api/tianditu/search', window.location.origin).toString() + '?' + `,
      )
      .replace(
        /fetch\s*\(\s*`\/api\/tianditu\/search\?/g,
        `fetch(new URL('/api/tianditu/search', window.location.origin).toString() + \`?`,
      )

    const directBodyPattern = /fetch\s*\(\s*([A-Za-z_$][\w$]*)\s*,\s*\{[\s\S]*?\bbody\s*:\s*JSON\.stringify\(\s*postStr\s*\)[\s\S]*?\}\s*\)/g
    const wrappedBodyPattern = /fetch\s*\(\s*([A-Za-z_$][\w$]*)\s*,\s*\{[\s\S]*?\bbody\s*:\s*JSON\.stringify\(\s*\{\s*postStr(?:\s*:\s*postStr)?\s*\}\s*\)[\s\S]*?\}\s*\)/g

    const replacedDirect = directBodyPattern.test(next)
    directBodyPattern.lastIndex = 0
    next = next.replace(
      directBodyPattern,
      (_m, urlVar) => `fetch(__buildTiandituSearchProxyUrl(${urlVar}, postStr))`,
    )

    const replacedWrapped = wrappedBodyPattern.test(next)
    wrappedBodyPattern.lastIndex = 0
    next = next.replace(
      wrappedBodyPattern,
      (_m, urlVar) => `fetch(__buildTiandituSearchProxyUrl(${urlVar}, { postStr: postStr }))`,
    )

    if (replacedDirect || replacedWrapped) {
      next = this.injectSearchProxyHelper(next)
    }

    return next
  }

  private injectSearchProxyHelper(code: string): string {
    if (code.includes('function __buildTiandituSearchProxyUrl(')) return code

    const helper = `<script>
function __buildTiandituSearchProxyUrl(baseUrl, payload) {
  var source = payload && typeof payload === 'object' && payload.postStr && typeof payload.postStr === 'object'
    ? payload.postStr
    : payload;
  var p = source || {};
  var q = new URLSearchParams();
  var add = function(k, v) {
    if (v == null || v === '') return;
    q.set(k, String(v));
  };

  add('keyWord', p.keyWord != null ? p.keyWord : p.keyword);
  add('queryType', p.queryType);
  add('start', p.start);
  add('count', p.count);
  add('level', p.level);
  if (Number(p.queryType) === 13 && (p.mapBound == null || p.mapBound === '')) {
    add('mapBound', '73.0,3.0,135.0,54.0');
  } else {
    add('mapBound', p.mapBound);
  }
  add('specify', p.specify);
  add('dataTypes', p.dataTypes);
  add('show', p.show);
  add('pointLonlat', p.pointLonlat);
  add('queryRadius', p.queryRadius);
  add('polygon', p.polygon);

  var root = (typeof baseUrl === 'string' && baseUrl) ? baseUrl : '/api/tianditu/search';
  if (!/^https?:\\/\\//i.test(root)) {
    root = new URL(root, window.location.origin).toString();
  }
  var qs = q.toString();
  if (!qs) return root;
  return root + (root.indexOf('?') >= 0 ? '&' : '?') + qs;
}
</script>`

    if (/<\/body>/i.test(code)) {
      return code.replace(/<\/body>/i, `${helper}\n</body>`)
    }
    return `${code}\n${helper}`
  }
}

function normalizeComparableCode(code: string): string {
  return String(code || '').replace(/\r\n/g, '\n').trim()
}

function findPatchMarkerIndex(content: string): number {
  const indexes = [...content.matchAll(/(?:-{3,}|<{3,})\s*SEARCH/g)]
    .map((match) => match.index ?? -1)
    .filter((index) => index >= 0)
  if (!indexes.length) return -1
  return Math.min(...indexes)
}

function createProtocolFailureReport(blockIndex: number, rawContent: string): PatchBlockReport {
  const normalized = String(rawContent || '').trim()
  const compact = normalized.replace(/\s+/g, ' ').trim()
  const preview = compact
    ? compact.slice(0, 220)
    : '（空响应）'

  return {
    blockIndex,
    status: 'failed',
    occurrences: 0,
    message: '上一轮没有输出任何可解析的 SEARCH/REPLACE blocks，属于协议失败，请直接返回合规的局部 patch。',
    searchPreview: '（无可解析 SEARCH）',
    replacePreview: '（无可解析 REPLACE）',
    nearbyContext: normalized
      ? normalized.slice(0, 600)
      : '模型未返回可用 patch 内容。',
  }
}

function summarizePatchReports(reports: PatchBlockReport[]): string {
  const appliedCount = reports.filter((report) => report.status === 'applied').length
  const failedCount = reports.filter((report) => report.status === 'failed').length
  if (appliedCount > 0 && failedCount === 0) {
    return `本次修复共应用 ${appliedCount} 处局部改动。`
  }
  if (appliedCount > 0) {
    return `本次修复已应用 ${appliedCount} 处局部改动，仍有 ${failedCount} 处改动命中过于模糊。`
  }
  return '本轮未能稳定应用局部 patch。'
}

function summarizeUpdatePatchReports(reports: PatchBlockReport[]): string {
  const appliedCount = reports.filter((report) => report.status === 'applied').length
  const failedCount = reports.filter((report) => report.status === 'failed').length
  if (appliedCount > 0 && failedCount === 0) {
    return `已根据新需求更新现有代码，以下高亮显示本次改动。`
  }
  if (appliedCount > 0) {
    return `本次更新已应用 ${appliedCount} 处局部改动，仍有 ${failedCount} 处需要继续收敛。`
  }
  return '本轮未能稳定应用局部 patch。'
}
