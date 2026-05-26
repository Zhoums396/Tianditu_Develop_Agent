import { useEffect } from 'react'
import { withBasePath } from '../../utils/basePath'

const WIDGET_SCRIPT_ID = 'tianditu-chat-widget-script'
const WIDGET_SELECTORS = [
  '.chat-widget-window',
  '.chat-widget-button',
  '.chat-widget-container',
  '#chat-widget-root',
]
const HIDDEN_WIDGET_ACTION_TEXTS = new Set(['问规范'])

function cleanupWidgetDom() {
  for (const selector of WIDGET_SELECTORS) {
    document.querySelectorAll(selector).forEach((node) => node.remove())
  }
}

function cleanupWidgetActions() {
  document
    .querySelectorAll('button, a, [role="button"]')
    .forEach((node) => {
      const text = (node.textContent || '').replace(/\s+/g, '').trim()
      if (HIDDEN_WIDGET_ACTION_TEXTS.has(text)) {
        node.remove()
      }
    })
}

export function ChatWidgetLoader() {
  useEffect(() => {
    cleanupWidgetDom()

    const existing = document.getElementById(WIDGET_SCRIPT_ID)
    existing?.remove()

    const script = document.createElement('script')
    script.id = WIDGET_SCRIPT_ID
    script.src = withBasePath('/assistant/widget.js')
    script.dataset.apiUrl = withBasePath('/assistant-api')
    script.dataset.title = '天地图智能机器人'
    script.dataset.subtitle = '天地图知识库为您服务'
    script.defer = true
    document.body.appendChild(script)

    const observer = new MutationObserver(cleanupWidgetActions)
    observer.observe(document.body, { childList: true, subtree: true })
    const intervalId = window.setInterval(cleanupWidgetActions, 250)
    const stopPollingId = window.setTimeout(() => window.clearInterval(intervalId), 5000)
    script.addEventListener('load', cleanupWidgetActions)
    cleanupWidgetActions()

    return () => {
      observer.disconnect()
      window.clearInterval(intervalId)
      window.clearTimeout(stopPollingId)
      script.removeEventListener('load', cleanupWidgetActions)
      script.remove()
      cleanupWidgetDom()
    }
  }, [])

  return null
}
