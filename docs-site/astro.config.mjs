import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

export default defineConfig({
  base: process.env.DOCS_BASE_PATH ?? '/docs',
  site: process.env.DOCS_SITE_URL ?? 'https://example.com',
  integrations: [
    starlight({
      title: '天地图开发智能体',
      description: '面向业务、交付与运营团队的系统使用教程与交付说明。',
      tagline: '系统使用说明与交付教程',
      favicon: '/tianditu-logo.png',
      locales: {
        root: {
          label: '简体中文',
          lang: 'zh-CN',
        },
      },
      customCss: ['/src/styles/custom.css'],
      components: {
        SiteTitle: './src/components/SiteTitle.astro',
      },
      lastUpdated: false,
      credits: false,
      sidebar: [
        {
          label: '开始之前',
          items: [
            { slug: 'index', label: '文档首页' },
            { slug: 'system-overview', label: '系统整体介绍' },
            { slug: 'scenarios', label: '典型使用情景' },
            { slug: 'quickstart', label: '5 分钟快速上手' },
          ],
        },
        {
          label: '构建应用',
          items: [
            { slug: 'story-builder', label: '从 0 开始构建故事地图' },
            { slug: 'data-builder', label: '从 0 开始构建数据驱动应用' },
            { slug: 'quality', label: '修改迭代与质量保障' },
          ],
        },
        {
          label: '发布与维护',
          items: [
            { slug: 'publish', label: '分享、公开与管理' },
            { slug: 'faq', label: '常见问题' },
          ],
        },
      ],
    }),
  ],
})
