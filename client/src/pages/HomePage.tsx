import { useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { exampleCards, type ExampleCard } from '../data/exampleCards'
import { useAuthStore } from '../stores/useAuthStore'
import { docsUrl } from '../utils/docsUrl'
import { appAsset } from '../utils/basePath'
import { UserMenu } from '../components/auth/UserMenu'

function CardPreview({ example }: { example: ExampleCard }) {
  const variant = example.preview
  const coverUrl = example.coverUrl ? appAsset(example.coverUrl) : ''
  const dark = variant === 'points' || variant === 'flood'
  const satellite = variant === 'parcel' || variant === 'bar3d'
  const accent = variant === 'history'
    ? 'bg-red-500'
    : variant === 'pin'
      ? 'bg-rose-500'
      : variant === 'points' || variant === 'flood'
        ? 'bg-emerald-500'
        : 'bg-blue-500'

  return (
    <div className={`relative aspect-[1.72/1] overflow-hidden ${dark ? 'bg-slate-900' : satellite ? 'bg-stone-200' : 'bg-[#e8f0e3]'}`}>
      {coverUrl ? (
        <img
          src={coverUrl}
          alt={`${example.title}封面`}
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.025]"
          loading="lazy"
        />
      ) : (
        <>
      <div
        className={`absolute inset-0 ${dark ? 'opacity-25' : 'opacity-60'}`}
        style={{
          backgroundImage:
            dark
              ? 'linear-gradient(28deg, transparent 0 44%, rgba(255,255,255,.45) 44.5% 45.2%, transparent 45.8%), linear-gradient(145deg, transparent 0 58%, rgba(255,255,255,.35) 58.4% 59%, transparent 59.6%)'
              : 'linear-gradient(28deg, transparent 0 44%, rgba(204,132,50,.55) 44.5% 45.5%, transparent 46%), linear-gradient(145deg, transparent 0 58%, rgba(224,168,70,.55) 58.4% 59.6%, transparent 60.2%), linear-gradient(88deg, transparent 0 52%, rgba(137,171,102,.4) 52.2% 53%, transparent 53.5%)',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: dark
            ? 'radial-gradient(circle at 22% 24%, rgba(71,85,105,.8) 0 10%, transparent 11%), radial-gradient(circle at 78% 64%, rgba(30,41,59,.9) 0 12%, transparent 13%)'
            : 'radial-gradient(circle at 20% 22%, rgba(181,215,239,.85) 0 13%, transparent 14%), radial-gradient(circle at 78% 62%, rgba(180,218,188,.9) 0 12%, transparent 13%), radial-gradient(circle at 50% 80%, rgba(226,235,215,.9) 0 18%, transparent 19%)',
        }}
      />

      {variant === 'map' && (
        <>
          <div className="absolute left-0 right-0 top-11 h-2 bg-amber-300/75 rotate-[-6deg] shadow-[0_0_0_1px_rgba(255,255,255,.7)]" />
          <div className="absolute left-12 right-3 bottom-8 h-1.5 bg-white/90 rotate-[5deg] shadow-[0_0_0_1px_rgba(239,197,82,.7)]" />
          <div className="absolute right-12 top-10 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-white" />
        </>
      )}

      {variant === 'pin' && (
        <>
          <div className="absolute left-0 right-0 top-12 h-2 bg-amber-300/75 rotate-[4deg]" />
          <div className="absolute left-12 top-9 h-3 w-3 rounded-full bg-rose-500 ring-2 ring-white" />
          <div className="absolute right-16 top-14 h-3 w-3 rounded-full bg-rose-500 ring-2 ring-white" />
          <div className="absolute left-1/2 bottom-8 h-3 w-3 rounded-full bg-rose-500 ring-2 ring-white" />
        </>
      )}

      {variant === 'parcel' && (
        <>
          <div className="absolute left-9 top-7 h-12 w-16 border-2 border-white/90 bg-emerald-500/20" />
          <div className="absolute left-24 top-12 h-10 w-20 border-2 border-white/90 bg-amber-500/20" />
          <div className="absolute right-10 top-8 h-14 w-16 border-2 border-white/90 bg-sky-500/20" />
        </>
      )}

      {variant === 'points' && (
        <>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_40%,rgba(16,185,129,.45),transparent_18%),radial-gradient(circle_at_70%_60%,rgba(59,130,246,.3),transparent_20%)]" />
          <div className="absolute right-10 top-8 h-2.5 w-2.5 rounded-full bg-emerald-300 ring-2 ring-white/80" />
          <div className="absolute right-20 top-16 h-2.5 w-2.5 rounded-full bg-emerald-300 ring-2 ring-white/80" />
          <div className="absolute right-14 bottom-10 h-2.5 w-2.5 rounded-full bg-emerald-300 ring-2 ring-white/80" />
        </>
      )}

      {variant === 'flood' && (
        <>
          <div className="absolute left-8 top-8 h-16 w-16 rounded-full bg-cyan-400/35 blur-md" />
          <div className="absolute left-24 top-12 h-20 w-20 rounded-full bg-blue-400/30 blur-md" />
          <div className="absolute right-10 bottom-8 h-16 w-16 rounded-full bg-sky-300/35 blur-md" />
        </>
      )}

      {variant === 'history' && (
        <>
          <svg viewBox="0 0 200 110" className="absolute inset-0 w-full h-full">
            <path d="M18 72 C 44 42, 62 76, 88 48 S 132 34, 182 58" fill="none" stroke="rgba(220,38,38,.9)" strokeWidth="3.5" strokeLinecap="round" />
            <path d="M24 84 C 58 56, 90 94, 132 68" fill="none" stroke="rgba(234,88,12,.86)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="5 5" />
          </svg>
          <div className="absolute left-8 top-8 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-white" />
          <div className="absolute right-16 bottom-8 w-8 h-8 rounded-full border border-red-200 bg-white/75 flex items-center justify-center text-[10px] font-semibold text-red-600">90</div>
        </>
      )}

      {variant === 'drive' && (
        <>
          <svg viewBox="0 0 200 110" className="absolute inset-0 w-full h-full">
            <path d="M18 80 C 55 20, 120 92, 178 30" fill="none" stroke="rgba(37,99,235,.92)" strokeWidth="4" strokeLinecap="round" />
          </svg>
          <div className="absolute left-4 bottom-6 w-3 h-3 rounded-full bg-green-500 border-2 border-white" />
          <div className="absolute right-5 top-6 w-3 h-3 rounded-full bg-rose-500 border-2 border-white" />
        </>
      )}

      {variant === 'transit' && (
        <>
          <svg viewBox="0 0 200 110" className="absolute inset-0 w-full h-full">
            <path d="M20 28 L176 28" fill="none" stroke="rgba(14,165,233,.9)" strokeWidth="3" strokeLinecap="round" />
            <path d="M34 80 C 76 44, 120 92, 168 54" fill="none" stroke="rgba(245,158,11,.9)" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <div className="absolute left-10 top-[25px] w-2 h-2 rounded-full bg-white ring-2 ring-sky-500" />
          <div className="absolute right-9 top-[25px] w-2 h-2 rounded-full bg-white ring-2 ring-sky-500" />
        </>
      )}

      {variant === 'admin' && (
        <>
          <svg viewBox="0 0 200 110" className="absolute inset-0 w-full h-full">
            <path d="M28 26 L88 20 L116 32 L162 26 L176 52 L148 74 L106 82 L64 78 L40 54 Z" fill="rgba(96,165,250,.18)" stroke="rgba(37,99,235,.82)" strokeWidth="2" />
            <path d="M86 22 L90 79" stroke="rgba(37,99,235,.62)" strokeWidth="1.5" />
            <path d="M120 31 L108 81" stroke="rgba(37,99,235,.62)" strokeWidth="1.5" />
          </svg>
        </>
      )}

      {variant === 'batch' && (
        <>
          <div className="absolute left-5 top-5 bottom-5 w-16 bg-white/80 shadow-sm" />
          <div className="absolute left-8 top-9 w-9 h-1.5 rounded bg-slate-300" />
          <div className="absolute left-8 top-[3.1rem] w-10 h-1.5 rounded bg-slate-300" />
          <div className="absolute right-8 top-8 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
          <div className="absolute right-14 top-[3.75rem] w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
        </>
      )}

      {variant === 'bar3d' && (
        <>
          <div className="absolute left-7 bottom-6 w-5 h-8 rounded-t bg-blue-500/75" />
          <div className="absolute left-[3.75rem] bottom-6 w-5 h-12 rounded-t bg-blue-500/82" />
          <div className="absolute left-[5.75rem] bottom-6 w-5 h-16 rounded-t bg-blue-500/92" />
          <div className="absolute right-8 bottom-5 text-[10px] font-medium text-slate-700">GDP</div>
        </>
      )}

      <div className="absolute left-3 top-3 rounded-sm bg-white/90 px-2 py-1 text-[10px] font-medium text-slate-500 shadow-sm">天地图示意</div>
      <div className={`absolute bottom-3 right-3 h-2.5 w-2.5 rounded-full ${accent} ring-2 ring-white`} />
        </>
      )}
      <div className="absolute inset-0 flex translate-y-3 flex-col justify-end bg-gradient-to-t from-slate-950/82 via-slate-950/36 to-transparent p-5 opacity-0 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100">
        <div className="text-base font-semibold leading-6 text-white">{example.title}</div>
        <div className="mt-2 text-sm leading-6 text-white/82 line-clamp-3">{example.desc}</div>
      </div>
    </div>
  )
}

export function HomePage() {
  const navigate = useNavigate()
  const { status, session, refresh, openLogin, openLogout } = useAuthStore()

  useEffect(() => {
    if (status === 'idle') {
      void refresh().catch(() => {})
    }
  }, [status, refresh])

  const authEnabled = session?.enabled === true
  const isAuthenticated = session?.authenticated === true
  const workspaceEntryPath = '/workspace'

  const openWorkspace = (path = workspaceEntryPath) => {
    if (authEnabled && !isAuthenticated) {
      openLogin(path)
      return
    }
    navigate(path)
  }

  const handleExample = (_example: ExampleCard, index: number) => {
    const path = `/workspace?exampleIndex=${index}`
    openWorkspace(path)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50/30 overflow-hidden">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(59,130,246,.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(59,130,246,.35) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        />

        <div className="hidden lg:block absolute top-[140px] -left-[220px] w-[520px] h-[220px] rounded-[50%] border-[24px] border-blue-100/70 rotate-12" />
        <div className="hidden lg:block absolute top-[198px] -left-[130px] w-[440px] h-[170px] rounded-[50%] border-[18px] border-cyan-100/65 rotate-6" />
        <div className="hidden lg:block absolute top-[136px] -right-[230px] w-[520px] h-[220px] rounded-[50%] border-[24px] border-blue-100/70 -rotate-12" />
        <div className="hidden lg:block absolute top-[198px] -right-[130px] w-[440px] h-[170px] rounded-[50%] border-[18px] border-cyan-100/65 -rotate-6" />

        <div className="absolute -top-28 right-20 w-64 h-64 rounded-full bg-blue-100/45 blur-3xl" />
        <div className="absolute top-1/3 -left-16 w-56 h-56 rounded-full bg-cyan-100/45 blur-3xl" />
        <div className="absolute bottom-14 right-1/4 w-72 h-72 rounded-full bg-sky-100/35 blur-3xl" />
      </div>

      <div className="relative">
        <header className="flex h-16 items-center justify-between px-6 max-w-6xl mx-auto">
          <div className="flex items-center gap-3">
            <img src={appAsset('/tianditu-logo.png')} alt="天地图" className="h-9 object-contain" />
            <div className="w-px h-7 bg-gray-200" />
            <img src={appAsset('/tianditu-agent-logo.svg')} alt="天地图开发智能体" className="h-8 sm:h-9 w-auto object-contain" />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.location.assign(docsUrl)}
              className="h-11 px-6 rounded-[3px] text-sm font-medium border border-slate-200 bg-white text-slate-600 hover:text-blue-600 hover:border-blue-200 hover:bg-blue-50/60 transition-all duration-200"
            >
              使用文档
            </button>
            <button
              onClick={() => navigate('/gallery')}
              className="h-11 px-6 rounded-[3px] text-sm font-medium border border-slate-200 bg-white text-slate-600 hover:text-blue-600 hover:border-blue-200 hover:bg-blue-50/60 transition-all duration-200"
            >
              公开样例
            </button>
            {isAuthenticated && (
              <UserMenu session={session} onLogout={() => openLogout('/')} />
            )}
            <button
              onClick={() => openWorkspace()}
              className="group flex h-11 items-center gap-2 rounded-[3px] bg-[#647bd9] px-6 text-sm font-medium text-white hover:bg-[#8fa3e7] hover:shadow-lg hover:shadow-[#647bd9]/25 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200"
            >
              {authEnabled && !isAuthenticated ? '统一登录' : '开始使用'}
              <svg className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </button>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-6 pt-10 pb-14 text-center">
          <div className="mx-auto max-w-4xl">
            <h1 className="text-[46px] md:text-[56px] font-bold text-gray-900 mb-5 leading-[1.04] tracking-tight">
              用自然语言
              <br />
              <span className="bg-gradient-to-r from-blue-600 via-blue-500 to-cyan-500 bg-clip-text text-transparent">
                创建天地图应用
              </span>
            </h1>
            <p className="text-lg text-gray-500 mb-6 max-w-3xl mx-auto leading-relaxed">
              描述你想要的地图效果，AI 自动生成可运行代码。点击下方案例可直接进入工作区。
            </p>
          </div>

          <section className="text-left">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-800">案例场景</h2>
              <span className="text-xs text-slate-400">共 {exampleCards.length} 个</span>
            </div>

            <div className="grid grid-cols-1 gap-x-7 gap-y-8 sm:grid-cols-2 xl:grid-cols-3">
              {exampleCards.map((ex, i) => (
                <button
                  key={ex.title}
                  onClick={() => handleExample(ex, i)}
                  className="group bg-white text-left overflow-hidden shadow-[0_12px_28px_rgba(15,23,42,0.10)] hover:shadow-[0_20px_42px_rgba(15,23,42,0.16)] hover:-translate-y-0.5 transition-all duration-250"
                  style={{ animationDelay: `${i * 35}ms` }}
                >
                  <CardPreview example={ex} />

                  <div className="px-5 pb-5 pt-4">
                    <div className="text-[18px] font-semibold leading-6 text-slate-900 line-clamp-1">{ex.title}</div>
                    <div className="mt-2 min-h-[44px] text-[13px] leading-[22px] text-slate-500 line-clamp-2">{ex.desc}</div>

                    <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                      <span className="text-sm font-medium text-blue-600">运行案例</span>
                      <svg className="w-4 h-4 text-slate-400 group-hover:text-blue-600 group-hover:translate-x-0.5 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M5 12h14m0 0-5-5m5 5-5 5" />
                      </svg>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>

        </main>

        <footer className="border-t border-slate-200/80 bg-white/85 backdrop-blur-sm">
          <div className="max-w-6xl mx-auto px-6 py-5 text-sm text-slate-600">
            <div className="flex flex-col sm:flex-row items-center justify-center text-center gap-2 sm:gap-4">
              <span className="font-medium text-slate-700">技术支持</span>
              <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-slate-500 text-[13px]">
                <span>邮箱：tdt@ngcc.cn</span>
                <span className="hidden sm:inline text-slate-300">|</span>
                <span>电话：010-63881233</span>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 bg-white">
            <div className="max-w-6xl mx-auto px-6 py-6">
              <div className="flex flex-wrap items-center justify-center gap-2 text-[13px] text-slate-500">
                <a href="https://www.tianditu.gov.cn/about/" target="_blank" rel="noreferrer" className="hover:text-blue-600 transition-colors">
                  关于我们
                </a>
                <span className="text-slate-300">|</span>
                <a href="https://www.tianditu.gov.cn/about/service" target="_blank" rel="noreferrer" className="hover:text-blue-600 transition-colors">
                  服务条款
                </a>
                <span className="text-slate-300">|</span>
                <a href="http://www.tianditu.gov.cn/about/copyright" target="_blank" rel="noreferrer" className="hover:text-blue-600 transition-colors">
                  版权声明
                </a>
                <span className="text-slate-300">|</span>
                <a href="http://www.tianditu.gov.cn/about/contact" target="_blank" rel="noreferrer" className="hover:text-blue-600 transition-colors">
                  联系我们
                </a>
                <span className="text-slate-300">|</span>
                <a href="http://www.tianditu.gov.cn/feedback" target="_blank" rel="noreferrer" className="hover:text-blue-600 transition-colors">
                  意见反馈
                </a>
              </div>

              <div className="mt-3 text-center text-[13px] text-slate-500">
                <a href="http://www.ngcc.cn/" target="_blank" rel="noreferrer" className="hover:text-blue-600 transition-colors">
                  国家基础地理信息中心
                </a>
                <span className="ml-2">版权所有</span>
              </div>

              <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[12px] text-slate-400">
                <span>甲测资字1100471</span>
                <span>京ICP备18044900号-2</span>
                <span>京公网安备11010202008132号</span>
              </div>

              <div className="mt-4 flex justify-center">
                <img src="https://dcs.conac.cn/image/blue.png" alt="党政机关网站标识" className="h-9 w-auto opacity-90" />
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  )
}
