import { useTiandituTokenStore } from '../stores/useTiandituTokenStore'
import { appBasePath } from './basePath'

const RUNTIME_MARKER = 'data-tdt-runtime-support="true"'

function buildRuntimeSupportScript(): string {
  const basePath = appBasePath || ''
  return `<script ${RUNTIME_MARKER}>
;(function () {
  var basePath = ${JSON.stringify(basePath)};
  if (!basePath || basePath === '/') return;
  basePath = '/' + String(basePath).replace(/^\\/+|\\/+$/g, '');

  function getPageOrigin() {
    try {
      if (window.location && window.location.origin && window.location.origin !== 'null') {
        return window.location.origin;
      }
    } catch (_) {}
    try {
      if (window.parent && window.parent.location && window.parent.location.origin) {
        return window.parent.location.origin;
      }
    } catch (_) {}
    try {
      if (document.referrer) {
        return new URL(document.referrer).origin;
      }
    } catch (_) {}
    return '';
  }

  function rewriteApiUrl(input) {
    try {
      var pageOrigin = getPageOrigin();
      if (!pageOrigin) return input;
      var url = new URL(String(input), pageOrigin + '/');
      if (url.origin === pageOrigin && url.pathname.indexOf('/api/') === 0) {
        url.pathname = basePath + url.pathname;
        return url.toString();
      }
    } catch (_) {}
    return input;
  }

  window.__TDT_APP_BASE_PATH__ = basePath;
  window.__TDT_API_URL__ = function (path) {
    var value = String(path || '');
    if (!/^https?:\\/\\//i.test(value) && value.charAt(0) !== '/') value = '/' + value;
    return rewriteApiUrl(value);
  };

  if (!window.__TDT_FETCH_PATCHED__) {
    window.__TDT_FETCH_PATCHED__ = true;
    var nativeFetch = window.fetch;
    if (typeof nativeFetch === 'function') {
      window.fetch = function (input, init) {
        if (typeof input === 'string' || input instanceof URL) {
          return nativeFetch.call(this, rewriteApiUrl(input), init);
        }
        if (input && typeof Request !== 'undefined' && input instanceof Request) {
          var rewritten = rewriteApiUrl(input.url);
          if (rewritten !== input.url) {
            input = new Request(rewritten, input);
          }
        }
        return nativeFetch.call(this, input, init);
      };
    }

    if (typeof XMLHttpRequest !== 'undefined') {
      var nativeOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url) {
        arguments[1] = rewriteApiUrl(url);
        return nativeOpen.apply(this, arguments);
      };
    }
  }
}());
</script>`
}

function injectRuntimeSupport(code: string): string {
  if (!code || code.includes(RUNTIME_MARKER)) return code
  const script = buildRuntimeSupportScript()
  if (/<head(\s[^>]*)?>/i.test(code)) {
    return code.replace(/<head(\s[^>]*)?>/i, (match) => `${match}\n${script}`)
  }
  if (/<html(\s[^>]*)?>/i.test(code)) {
    return code.replace(/<html(\s[^>]*)?>/i, (match) => `${match}\n${script}`)
  }
  return `${script}\n${code}`
}

export function injectTiandituTokenPlaceholders(code: string): string {
  const text = String(code || '')
  if (!text) return text
  const token = useTiandituTokenStore.getState().token
  let next = injectRuntimeSupport(text)
  if (!token) return next

  next = next
    .replace(/\$\{TIANDITU_TOKEN\}/g, token)
    .replace(/\b(?:your_tianditu_token_here|YOUR_TIANDITU_TOKEN|YOUR_TIANDITU_API_KEY|your_tianditu_api_key)\b/g, token)
  return next
}
