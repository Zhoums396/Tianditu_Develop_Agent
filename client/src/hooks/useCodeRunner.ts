import { useCallback, useEffect, useRef } from 'react'
import { useMapStore } from '../stores/useMapStore'

function buildCaptureScriptTag(runId: string) {
  return `<script>
    (function() {
      var __codexRunId = ${JSON.stringify(runId)};
      var __codexRenderState = window.__codexRenderState = {
        pendingRequests: 0,
        lastNetworkActivityAt: Date.now ? Date.now() : new Date().getTime(),
        lastDomMutationAt: Date.now ? Date.now() : new Date().getTime()
      };

      function markRenderActivity(kind, delta) {
        var t = Date.now ? Date.now() : new Date().getTime();
        try {
          if (typeof delta === 'number') {
            __codexRenderState.pendingRequests = Math.max(0, Number(__codexRenderState.pendingRequests || 0) + delta);
          }
          if (kind === 'network') __codexRenderState.lastNetworkActivityAt = t;
          if (kind === 'dom') __codexRenderState.lastDomMutationAt = t;
        } catch (_) {}
      }

      try {
        var observer = new MutationObserver(function() {
          markRenderActivity('dom', 0);
        });
        observer.observe(document.documentElement || document, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true
        });
      } catch (_) {}

      function patchCanvasContexts() {
        function patch(proto) {
          if (!proto || typeof proto.getContext !== 'function' || proto.__codexCapturePatched) return;
          var originalGetContext = proto.getContext;
          Object.defineProperty(proto, '__codexCapturePatched', {
            value: true,
            configurable: false,
            enumerable: false,
            writable: false
          });

          proto.getContext = function(type, attrs) {
            var kind = String(type || '').toLowerCase();
            if (kind === 'webgl' || kind === 'experimental-webgl' || kind === 'webgl2') {
              var nextAttrs = {};
              if (attrs && typeof attrs === 'object') {
                for (var key in attrs) nextAttrs[key] = attrs[key];
              }
              nextAttrs.preserveDrawingBuffer = true;
              try {
                return originalGetContext.call(this, type, nextAttrs);
              } catch (_) {}
            }
            return originalGetContext.call(this, type, attrs);
          };
        }

        try { patch(window.HTMLCanvasElement && HTMLCanvasElement.prototype); } catch (_) {}
        try {
          if (typeof OffscreenCanvas !== 'undefined') patch(OffscreenCanvas.prototype);
        } catch (_) {}
      }

      patchCanvasContexts();

      var ignorePatterns = [
        '_mouseRotate', '_mouseZoom', '_touchRotate', '_touchZoom',
        'Script error', 'ResizeObserver loop',
        'Ignored call to', 'allow-modals',
        'favicon.ico',
        // 天地图字体资源 404（常见于 symbol 文本图层字体栈请求），通常不影响底图与核心交互
        'vector.tianditu.gov.cn/static/font/',
        '/static/font/Open%20Sans%20Regular,Arial%20Unicode%20MS%20Regular/0-255.pbf',
        '/static/font/Microsoft%20YaHei%20Regular/0-255.pbf',
      ];
      var recentReports = Object.create(null);

      function now() {
        return Date.now ? Date.now() : new Date().getTime();
      }

      function shouldIgnore(msg, src) {
        var msgStr = String(msg || '');
        var srcStr = String(src || '');
        for (var i = 0; i < ignorePatterns.length; i++) {
          if (msgStr.indexOf(ignorePatterns[i]) !== -1) return true;
          if (srcStr.indexOf(ignorePatterns[i]) !== -1) return true;
        }
        if (msgStr === 'Script error.' || msgStr === 'Script error') return true;
        return false;
      }

      function stringifyError(err) {
        if (!err) return '';
        if (typeof err === 'string') return err;
        if (err.message) {
          return err.stack ? (String(err.message) + '\\n' + String(err.stack)) : String(err.message);
        }
        try { return JSON.stringify(err); } catch (_) {}
        return String(err);
      }

      function shouldDedup(msg, meta) {
        var key = [
          String(msg || ''),
          meta && meta.kind ? String(meta.kind) : '',
          meta && meta.src ? String(meta.src) : '',
          meta && meta.requestUrl ? String(meta.requestUrl) : '',
          meta && meta.status ? String(meta.status) : '',
        ].join('|');
        var t = now();
        var last = recentReports[key] || 0;
        if (t - last < 1200) return true;
        recentReports[key] = t;
        return false;
      }

      function report(msg, meta) {
        var src = meta && meta.src ? String(meta.src) : '';
        if (shouldIgnore(msg, src)) return;
        if (shouldDedup(msg, meta)) return;
        window.parent.postMessage({
          type: 'map-error',
          runId: __codexRunId,
          message: String(msg),
          src: src,
          line: meta && meta.line ? meta.line : 0,
          col: meta && meta.col ? meta.col : 0,
          kind: meta && meta.kind ? String(meta.kind) : '',
          requestUrl: meta && meta.requestUrl ? String(meta.requestUrl) : '',
          method: meta && meta.method ? String(meta.method) : '',
          status: meta && typeof meta.status === 'number' ? meta.status : 0
        }, '*');
      }

      // 1. 同步错误
      window.onerror = function(msg, src, line, col, err) {
        if (shouldIgnore(msg, src)) return true;
        var richMsg = stringifyError(err) || String(msg);
        report(richMsg, { src: src, line: line, col: col, kind: 'window.onerror' });
        return true;
      };

      // 2. error 事件（包括部分脚本错误路径）
      window.addEventListener('error', function(e) {
        if (!e) return;
        try {
          var target = e.target || e.srcElement;
          var tagName = target && target.tagName ? String(target.tagName).toUpperCase() : '';
          if (tagName === 'IMG' || tagName === 'LINK' || tagName === 'SOURCE') return;
        } catch (_) {}
        var err = e.error || null;
        var msg = stringifyError(err) || e.message || '脚本错误';
        var src = e.filename || '';
        if (shouldIgnore(msg, src)) return;
        report(msg, { src: src, line: e.lineno || 0, col: e.colno || 0, kind: 'error-event' });
      }, true);

      // 3. Promise 未处理异常（同源脚本稳定；跨域脚本不保证能拿到详情）
      window.addEventListener('unhandledrejection', function(e) {
        var msg = stringifyError(e && e.reason) || 'Promise 异常';
        report(msg, { src: 'unhandledrejection', kind: 'unhandledrejection' });
        if (e && e.preventDefault) e.preventDefault();
      });

      // 4. 拦截 console.error（补 SDK 内部错误日志）
      var origError = console.error;
      console.error = function() {
        var args = Array.prototype.slice.call(arguments);
        var msg = args.map(function(a) { return String(a); }).join(' ');
        if (
          msg.indexOf('Error') !== -1 ||
          msg.indexOf('TypeError') !== -1 ||
          msg.indexOf('AJAXError') !== -1 ||
          msg.indexOf('Not Found') !== -1 ||
          msg.indexOf('404') !== -1 ||
          msg.indexOf('失败') !== -1
        ) {
          report(msg, { kind: 'console.error' });
        }
        origError.apply(console, arguments);
      };

      // 5. Hook fetch：主动上报 4xx/5xx 和网络异常（比等 SDK 再抛错更接近根因）
      if (window.fetch) {
        var origFetch = window.fetch.bind(window);
        function getHttpBaseOrigin() {
          try {
            if (
              window.location &&
              typeof window.location.origin === 'string' &&
              /^https?:\\/\\//i.test(window.location.origin)
            ) {
              return window.location.origin;
            }
          } catch (_) {}
          try {
            if (document && document.referrer) {
              var ref = new URL(document.referrer);
              if (/^https?:$/i.test(ref.protocol)) return ref.origin;
            }
          } catch (_) {}
          return '';
        }

        function resolveFetchInput(input) {
          var currentInput = input;
          var rawUrl = '';
          try {
            if (typeof input === 'string') rawUrl = input;
            else if (input && typeof input.url === 'string') rawUrl = input.url;
          } catch (_) {}

          if (!rawUrl) {
            return { input: currentInput, url: rawUrl };
          }

          var resolvedUrl = rawUrl;
          try {
            var hasScheme = /^[a-zA-Z][a-zA-Z\\d+\\-.]*:/.test(rawUrl);
            var protocolRelative = rawUrl.indexOf('//') === 0;
            if (!hasScheme && !protocolRelative) {
              var baseOrigin = getHttpBaseOrigin();
              if (baseOrigin) {
                resolvedUrl = new URL(rawUrl, baseOrigin).toString();
              }
            }
          } catch (_) {}

          if (resolvedUrl !== rawUrl) {
            try {
              if (typeof input === 'string') {
                currentInput = resolvedUrl;
              } else if (typeof Request !== 'undefined' && input instanceof Request) {
                currentInput = new Request(resolvedUrl, input);
              }
            } catch (_) {}
          }

          return { input: currentInput, url: resolvedUrl };
        }

        window.fetch = function() {
          var args = Array.prototype.slice.call(arguments);
          var input = args[0];
          var init = args[1] || {};
          var url = '';
          var method = 'GET';
          try {
            if (typeof input === 'string') url = input;
            else if (input && typeof input.url === 'string') url = input.url;
            if (init && init.method) method = String(init.method);
            else if (input && input.method) method = String(input.method);
          } catch (_) {}

          try {
            var resolved = resolveFetchInput(input);
            args[0] = resolved.input;
            if (resolved.url) url = resolved.url;
          } catch (_) {}

          markRenderActivity('network', 1);
          return origFetch.apply(window, args).then(function(res) {
            try {
              if (res && typeof res.status === 'number' && res.status >= 400) {
                report(
                  'FetchError: ' + method + ' ' + (url || '[unknown]') + ' -> ' + res.status + ' ' + String(res.statusText || ''),
                  {
                    kind: 'fetch',
                    src: 'fetch',
                    requestUrl: url,
                    method: method,
                    status: res.status,
                  }
                );
              }
            } catch (_) {}
            return res;
          }).catch(function(err) {
            var msg = stringifyError(err) || 'fetch failed';
            report('FetchError: ' + msg, {
              kind: 'fetch',
              src: 'fetch',
              requestUrl: url,
              method: method,
            });
            throw err;
          }).finally(function() {
            markRenderActivity('network', -1);
          });
        };
      }

      // 6. Hook XMLHttpRequest：捕获 SDK AJAX 404/网络失败
      if (window.XMLHttpRequest && XMLHttpRequest.prototype) {
        var xhrProto = XMLHttpRequest.prototype;
        var origOpen = xhrProto.open;
        var origSend = xhrProto.send;

        xhrProto.open = function(method, url) {
          try {
            this.__codexMethod = method;
            this.__codexUrl = url;
          } catch (_) {}
          return origOpen.apply(this, arguments);
        };

        xhrProto.send = function() {
          var xhr = this;
          try {
            if (!xhr.__codexErrorHooked) {
              xhr.__codexErrorHooked = true;
              markRenderActivity('network', 1);

              xhr.addEventListener('loadend', function() {
                markRenderActivity('network', -1);
                var status = 0;
                try { status = Number(xhr.status || 0); } catch (_) {}
                if (status >= 400) {
                  var url = '';
                  var method = '';
                  try { url = String(xhr.__codexUrl || ''); } catch (_) {}
                  try { method = String(xhr.__codexMethod || ''); } catch (_) {}
                  var statusText = '';
                  try { statusText = String(xhr.statusText || ''); } catch (_) {}

                  report(
                    'AJAXError: ' + (statusText || 'HTTP Error') + ' (' + status + '): ' + (url || '[unknown]'),
                    {
                      kind: 'xhr',
                      src: 'XMLHttpRequest',
                      requestUrl: url,
                      method: method,
                      status: status,
                    }
                  );
                }
              });

              xhr.addEventListener('error', function() {
                var url = '';
                var method = '';
                try { url = String(xhr.__codexUrl || ''); } catch (_) {}
                try { method = String(xhr.__codexMethod || ''); } catch (_) {}
                report('AJAXError: Network error: ' + (url || '[unknown]'), {
                  kind: 'xhr',
                  src: 'XMLHttpRequest',
                  requestUrl: url,
                  method: method,
                });
              });

              xhr.addEventListener('timeout', function() {
                var url = '';
                var method = '';
                try { url = String(xhr.__codexUrl || ''); } catch (_) {}
                try { method = String(xhr.__codexMethod || ''); } catch (_) {}
                report('AJAXError: Timeout: ' + (url || '[unknown]'), {
                  kind: 'xhr',
                  src: 'XMLHttpRequest',
                  requestUrl: url,
                  method: method,
                });
              });
            }
          } catch (_) {}

          return origSend.apply(this, arguments);
        };
      }
    })();
  </script>`
}

function injectCaptureScript(code: string, runId: string) {
  const captureScript = buildCaptureScriptTag(runId)
  if (/<head[^>]*>/i.test(code)) {
    return code.replace(/<head[^>]*>/i, (m) => `${m}${captureScript}`)
  }
  if (/<html[^>]*>/i.test(code)) {
    return code.replace(/<html[^>]*>/i, (m) => `${m}<head>${captureScript}</head>`)
  }
  if (/<!doctype html[^>]*>/i.test(code)) {
    return code.replace(/<!doctype html[^>]*>/i, (m) => `${m}<head>${captureScript}</head>`)
  }
  return `${captureScript}${code}`
}

/**
 * iframe 安全执行 + 错误捕获
 * 捕获同步错误 + Promise 异常 + console.error
 * 并主动拦截 fetch/XHR 的 4xx/5xx / 网络错误
 */
export function useCodeRunner() {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const runSeqRef = useRef(0)
  const activeRunIdRef = useRef('')
  const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const blobUrlRef = useRef<string | null>(null)
  const { setExecError, setExecuting } = useMapStore()

  const run = useCallback((code: string) => {
    const iframe = iframeRef.current
    if (!iframe) return

    setExecuting(true)
    setExecError(null)

    const runId = `run-${Date.now()}-${runSeqRef.current + 1}`
    activeRunIdRef.current = runId

    // 注入错误捕获脚本（同步错误/Promise/console/fetch/xhr）
    const wrappedCode = injectCaptureScript(code, runId)
    const runSeq = ++runSeqRef.current

    if (finishTimerRef.current) {
      clearTimeout(finishTimerRef.current)
      finishTimerRef.current = null
    }

    const handleLoad = () => {
      if (runSeq !== runSeqRef.current) return
      if (finishTimerRef.current) {
        clearTimeout(finishTimerRef.current)
        finishTimerRef.current = null
      }
      setExecuting(false)
    }
    iframe.addEventListener('load', handleLoad, { once: true })

    /**
     * 使用 Blob URL 触发 iframe 导航，确保每次运行都是新的文档上下文，
     * 同时避免部分 SDK 在 srcdoc/about:srcdoc 下的兼容问题。
     */
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current)
      blobUrlRef.current = null
    }
    const blob = new Blob([wrappedCode], { type: 'text/html;charset=utf-8' })
    const blobUrl = URL.createObjectURL(blob)
    blobUrlRef.current = blobUrl
    iframe.src = blobUrl

    // 兜底：极少数情况下 load 事件不触发时，避免 UI 一直停在“渲染中”
    finishTimerRef.current = setTimeout(() => {
      if (runSeq === runSeqRef.current) {
        setExecuting(false)
      }
      finishTimerRef.current = null
    }, 2000)
  }, [setExecError, setExecuting])

  useEffect(() => {
    return () => {
      if (finishTimerRef.current) {
        clearTimeout(finishTimerRef.current)
        finishTimerRef.current = null
      }
      activeRunIdRef.current = ''
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }
    }
  }, [])

  return { iframeRef, run, activeRunIdRef }
}
