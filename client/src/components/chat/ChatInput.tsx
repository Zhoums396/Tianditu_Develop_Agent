import { Fragment, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from 'react'
import { JsonPreviewModal } from '../common/JsonPreviewModal'
import { formatFileSize, isJsonPreviewableFileName } from '../../utils/jsonPreview'
import { validateJsonLikeFile } from '../../utils/fileValidation'

interface ChatInputProps {
  onSend: (message: string, file?: File, filePreviewText?: string | null) => void
  loading: boolean
  disabled?: boolean
  disabledReason?: string | null
  placeholder?: string
  variant?: 'panel' | 'floating'
}

type UploadStep = 1 | 2 | 3

function isSupportedFile(candidate: File) {
  const name = candidate.name.toLowerCase()
  return ['.json', '.geojson', '.zip', '.kml'].some((ext) => name.endsWith(ext))
}

function readPrettyPreview(text: string | null) {
  if (!text?.trim()) return '暂无可预览内容'
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

interface UploadDialogProps {
  open: boolean
  loading: boolean
  error: string | null
  candidate: File | null
  previewText: string | null
  previewLoading: boolean
  onClose: () => void
  onPick: (file: File | null | undefined) => void
  onConfirm: () => void
}

function UploadDialog({
  open,
  loading,
  error,
  candidate,
  previewText,
  previewLoading,
  onClose,
  onPick,
  onConfirm,
}: UploadDialogProps) {
  const [step, setStep] = useState<UploadStep>(1)
  const [dragActive, setDragActive] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const preview = useMemo(() => readPrettyPreview(previewText), [previewText])
  const canPreview = !!candidate && isJsonPreviewableFileName(candidate.name)

  if (!open) return null

  const activeStep: UploadStep = candidate ? (canPreview ? 2 : 3) : step

  const handlePick = (file: File | null | undefined) => {
    setStep(2)
    onPick(file)
  }

  const handleDrag = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.type === 'dragenter' || event.type === 'dragover') {
      setDragActive(true)
    } else if (event.type === 'dragleave') {
      setDragActive(false)
    }
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setDragActive(false)
    handlePick(event.dataTransfer.files?.[0])
  }

  const handleClose = () => {
    setStep(1)
    setDragActive(false)
    if (inputRef.current) inputRef.current.value = ''
    onClose()
  }

  const handleConfirm = () => {
    setStep(1)
    setDragActive(false)
    if (inputRef.current) inputRef.current.value = ''
    onConfirm()
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 px-5">
      <div className="relative flex h-[min(78vh,720px)] w-[min(1120px,94vw)] flex-col rounded-[4px] bg-white shadow-2xl">
        <button
          type="button"
          onClick={handleClose}
          className="absolute right-7 top-6 text-slate-400 transition-colors hover:text-slate-700"
          aria-label="关闭数据上传"
        >
          <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="px-14 pt-12">
          <h2 className="text-[24px] font-semibold text-slate-950">数据上传</h2>
          <div className="mt-10 grid grid-cols-[auto_1fr_auto_1fr_auto] items-center gap-6 text-[20px]">
            {[
              { id: 1, label: '文件上传' },
              { id: 2, label: '数据预览' },
              { id: 3, label: '加入对话' },
            ].map((item, index) => (
              <Fragment key={item.id}>
                {index > 0 && <div key={`${item.id}-line`} className="h-px bg-slate-200" />}
                <div className="flex items-center gap-4">
                  <span
                    className={[
                      'flex h-10 w-10 items-center justify-center rounded-full text-[18px]',
                      activeStep >= item.id ? 'bg-[#647bd9] text-white' : 'bg-slate-100 text-slate-500',
                    ].join(' ')}
                  >
                    {item.id}
                  </span>
                  <span className={activeStep >= item.id ? 'text-slate-950' : 'text-slate-400'}>{item.label}</span>
                </div>
              </Fragment>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 px-14 py-12">
          {!candidate ? (
            <div
              onClick={() => inputRef.current?.click()}
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              className={[
                'flex h-full min-h-[360px] cursor-pointer flex-col items-center justify-center border border-dashed transition-colors',
                dragActive ? 'border-[#647bd9] bg-blue-50/40' : 'border-slate-300 bg-white hover:border-[#647bd9]',
              ].join(' ')}
            >
              <svg className="mb-12 h-16 w-16 text-[#647bd9]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m4-7 5-5 5 5m-5-5v12" />
              </svg>
              <div className="text-[22px] text-slate-950">点击或将文件拖动到此处进行上传</div>
              <div className="mt-7 text-[18px] text-slate-400">支持文件格式：geojson | json | shapefile(zip压缩包) | kml</div>
              {error && <div className="mt-5 text-sm text-red-500">{error}</div>}
            </div>
          ) : (
            <div className="flex h-full min-h-[360px] flex-col gap-4">
              <div className="flex items-center justify-between rounded-[4px] border border-slate-200 bg-slate-50 px-5 py-4">
                <div className="min-w-0">
                  <div className="truncate text-[18px] font-medium text-slate-900">{candidate.name}</div>
                  <div className="mt-1 text-sm text-slate-500">{formatFileSize(candidate.size)}</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setStep(1)
                    onPick(null)
                  }}
                  className="rounded-[3px] border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 transition-colors hover:border-[#647bd9] hover:text-[#647bd9]"
                >
                  重新选择
                </button>
              </div>

              <div className="min-h-0 flex-1 rounded-[4px] border border-slate-200 bg-white">
                {previewLoading || loading ? (
                  <div className="flex h-full items-center justify-center text-slate-500">正在读取数据...</div>
                ) : canPreview ? (
                  <pre className="h-full overflow-auto p-5 font-mono text-[12px] leading-6 text-slate-700">
                    {preview}
                  </pre>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center text-center">
                    <div className="text-[20px] font-medium text-slate-900">文件已就绪</div>
                    <div className="mt-3 max-w-[520px] text-sm leading-6 text-slate-500">
                      当前格式会作为附件加入对话，由后端按文件契约解析。JSON / GeoJSON 文件可在此处直接预览。
                    </div>
                  </div>
                )}
              </div>

              {error && <div className="text-sm text-red-500">{error}</div>}
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-[3px] border border-slate-200 bg-white px-5 py-2.5 text-sm text-slate-600 transition-colors hover:border-slate-300"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={previewLoading || loading}
                  className="rounded-[3px] bg-[#647bd9] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#8fa3e7] disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  加入对话
                </button>
              </div>
            </div>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".json,.geojson,.zip,.kml"
          className="hidden"
          onChange={(event: ChangeEvent<HTMLInputElement>) => handlePick(event.target.files?.[0])}
        />
      </div>
    </div>
  )
}

export function ChatInput({
  onSend,
  loading,
  disabled = false,
  disabledReason = null,
  placeholder = '描述你想要的地图效果...',
  variant = 'panel',
}: ChatInputProps) {
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [filePreviewText, setFilePreviewText] = useState<string | null>(null)
  const [filePreviewLoading, setFilePreviewLoading] = useState(false)
  const [filePreviewError, setFilePreviewError] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadCandidate, setUploadCandidate] = useState<File | null>(null)
  const [uploadCandidatePreviewText, setUploadCandidatePreviewText] = useState<string | null>(null)
  const [uploadCandidateLoading, setUploadCandidateLoading] = useState(false)
  const [uploadCandidateError, setUploadCandidateError] = useState<string | null>(null)
  const [uploadHint, setUploadHint] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const previewLoadIdRef = useRef(0)
  const inputLocked = loading || disabled
  const canPreviewCurrentFile = !!file && isJsonPreviewableFileName(file.name)

  const resetUploadDialog = () => {
    setUploadOpen(false)
    setUploadCandidate(null)
    setUploadCandidatePreviewText(null)
    setUploadCandidateLoading(false)
    setUploadCandidateError(null)
    previewLoadIdRef.current += 1
  }

  const pickUploadFile = async (candidate: File | null | undefined) => {
    if (inputLocked) return
    const requestId = previewLoadIdRef.current + 1
    previewLoadIdRef.current = requestId
    setUploadCandidate(null)
    setUploadCandidatePreviewText(null)
    setUploadCandidateLoading(false)
    setUploadCandidateError(null)

    if (!candidate) return
    if (!isSupportedFile(candidate)) {
      setUploadCandidateError('文件格式不支持，仅支持 GeoJSON / JSON / Shapefile(zip压缩包) / KML')
      return
    }

    setUploadCandidate(candidate)

    if (!isJsonPreviewableFileName(candidate.name)) {
      return
    }

    setUploadCandidateLoading(true)
    const validation = await validateJsonLikeFile(candidate)
    if (previewLoadIdRef.current !== requestId) return
    setUploadCandidateLoading(false)

    if (!validation.valid) {
      setUploadCandidate(null)
      setUploadCandidatePreviewText(null)
      setUploadCandidateError(validation.error)
      return
    }

    setUploadCandidatePreviewText(validation.previewText)
  }

  const confirmUploadFile = () => {
    if (!uploadCandidate) return
    setFile(uploadCandidate)
    setFilePreviewText(uploadCandidatePreviewText)
    setFilePreviewError(null)
    setFilePreviewLoading(false)
    setUploadHint(`已加入对话：${uploadCandidate.name}`)
    resetUploadDialog()
  }

  const removeFile = () => {
    setFile(null)
    setFilePreviewText(null)
    setFilePreviewError(null)
    setFilePreviewLoading(false)
    setPreviewOpen(false)
    setUploadHint(null)
    previewLoadIdRef.current += 1
  }

  const handleSend = () => {
    const msg = text.trim()
    if (!msg || inputLocked) return
    onSend(msg, file || undefined, filePreviewText)
    setText('')
    removeFile()
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const handleKey = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSend()
    }
  }

  const handleInput = (value: string) => {
    setText(value)
    if (uploadHint) setUploadHint(null)
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 120) + 'px'
    }
  }

  const isFloating = variant === 'floating'

  return (
    <div className={isFloating ? 'bg-transparent' : 'p-3 bg-white'}>
      {file && (
        <div className="flex items-center gap-2 mb-2 mx-1">
          <div className="flex max-w-full items-center gap-2 rounded-2xl border border-slate-200/85 bg-white/92 px-3 py-2 text-[12px] shadow-[0_12px_28px_rgba(15,23,42,0.05)] backdrop-blur-xl animate-fade-in">
            {canPreviewCurrentFile ? (
              <button
                type="button"
                onClick={() => setPreviewOpen(true)}
                className="min-w-0 flex flex-1 items-center gap-3 rounded-xl px-1 py-0.5 text-left text-slate-700 transition-colors hover:bg-slate-50/85 hover:text-slate-900"
                title="点击预览 JSON 文件"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-sky-100 bg-sky-50 text-sky-500">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                </span>
                <span className="min-w-0 flex flex-1 items-center gap-2">
                  <span className="truncate font-medium text-[13px] text-slate-700">{file.name}</span>
                  <span className="shrink-0 text-slate-400">({formatFileSize(file.size)})</span>
                </span>
                <span className="ml-auto shrink-0 rounded-full border border-sky-100 bg-sky-50 px-2.5 py-1 text-[10px] font-semibold text-sky-700">
                  预览
                </span>
              </button>
            ) : (
              <div className="min-w-0 flex flex-1 items-center gap-3 px-1 py-0.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-500">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                </span>
                <span className="min-w-0 flex flex-1 items-center gap-2">
                  <span className="truncate font-medium text-[13px] text-slate-700">{file.name}</span>
                  <span className="shrink-0 text-slate-400">({formatFileSize(file.size)})</span>
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={removeFile}
              className="ml-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-slate-300 transition-colors hover:bg-red-50 hover:text-red-400"
              aria-label="移除附件"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      <div className={isFloating ? 'relative rounded-[22px]' : 'relative rounded-2xl'}>
        {isFloating ? (
          <div className="min-h-[104px] rounded-[22px] border border-slate-200/85 bg-white/96 px-6 py-5 shadow-[0_14px_40px_rgba(15,23,42,0.14)] backdrop-blur-xl transition-colors focus-within:border-sky-300 focus-within:ring-4 focus-within:ring-sky-100/70">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(event) => handleInput(event.target.value)}
              onKeyDown={handleKey}
              placeholder={disabledReason || placeholder}
              disabled={inputLocked}
              rows={1}
              className="min-h-[34px] max-h-[96px] w-full resize-none border-0 bg-transparent text-[18px] leading-[1.45] text-slate-700 placeholder:text-slate-400 focus:outline-none disabled:cursor-not-allowed disabled:text-slate-400"
              style={{ overflow: 'hidden' }}
            />
            <div className="mt-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  if (!inputLocked) setUploadOpen(true)
                }}
                disabled={inputLocked}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-800 transition-colors hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent"
                title={disabledReason || '上传文件（GeoJSON/JSON/Shapefile/KML）'}
              >
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 5v14M5 12h14" />
                </svg>
              </button>

              <button
                type="button"
                onClick={handleSend}
                disabled={!text.trim() || inputLocked}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#647bd9] text-white transition-colors hover:bg-[#8fa3e7] disabled:bg-slate-100 disabled:text-slate-400"
                title={disabledReason || '发送'}
              >
                {loading ? (
                  <div className="h-5 w-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                ) : (
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        ) : (
        <div className="flex items-center min-h-[56px] rounded-[28px] border border-slate-200/85 bg-white/96 shadow-[0_1px_0_rgba(255,255,255,0.9)_inset,0_16px_36px_rgba(15,23,42,0.06)] backdrop-blur-xl transition-colors focus-within:border-sky-300 focus-within:ring-4 focus-within:ring-sky-100/70">
          <button
            type="button"
            onClick={() => {
              if (!inputLocked) setUploadOpen(true)
            }}
            disabled={inputLocked}
            className="ml-1.5 flex h-10 w-10 shrink-0 items-center justify-center self-center rounded-2xl text-slate-300 transition-colors hover:bg-slate-50 hover:text-sky-600 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-300"
            title={disabledReason || '上传文件（GeoJSON/JSON/Shapefile/KML）'}
          >
            <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
            </svg>
          </button>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => handleInput(event.target.value)}
            onKeyDown={handleKey}
            placeholder={disabledReason || placeholder}
            disabled={inputLocked}
            rows={1}
            className="min-h-[44px] max-h-[120px] flex-1 resize-none border-0 bg-transparent py-3 pr-2 text-[13.5px] leading-[1.45] text-slate-700 placeholder:text-slate-300 focus:outline-none disabled:cursor-not-allowed disabled:text-slate-400"
            style={{ overflow: 'hidden' }}
          />

          <button
            type="button"
            onClick={handleSend}
            disabled={!text.trim() || inputLocked}
            className={[
              'mr-1.5 shrink-0 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 p-2 text-white shadow-sm transition-colors hover:from-blue-600 hover:to-blue-700 hover:shadow-md hover:shadow-blue-500/20 active:scale-95',
              disabledReason ? 'disabled:opacity-40 disabled:scale-100' : 'disabled:opacity-0 disabled:scale-90',
            ].join(' ')}
            title={disabledReason || '发送'}
          >
            {loading ? (
              <div className="w-[18px] h-[18px] border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
              </svg>
            )}
          </button>
        </div>
        )}
      </div>

      <div className="mt-1.5 px-1 flex items-center gap-2">
        {uploadHint && (
          canPreviewCurrentFile ? (
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              className="min-w-0 flex-1 truncate text-left text-[11px] text-blue-500 underline decoration-blue-300 underline-offset-2 transition-colors hover:text-blue-600"
              title="点击预览当前 JSON 文件"
            >
              {uploadHint}
            </button>
          ) : (
            <div className="min-w-0 flex-1 truncate text-[11px] text-blue-500">{uploadHint}</div>
          )
        )}
      </div>

      <UploadDialog
        open={uploadOpen}
        loading={loading}
        error={uploadCandidateError}
        candidate={uploadCandidate}
        previewText={uploadCandidatePreviewText}
        previewLoading={uploadCandidateLoading}
        onClose={resetUploadDialog}
        onPick={pickUploadFile}
        onConfirm={confirmUploadFile}
      />

      <JsonPreviewModal
        open={previewOpen}
        title={file?.name || 'JSON 文件'}
        size={file?.size}
        jsonText={filePreviewText}
        loading={filePreviewLoading}
        error={filePreviewError}
        onClose={() => setPreviewOpen(false)}
      />
    </div>
  )
}
