import { defineConfig } from 'wxt';

export default defineConfig({
  imports: false,
  targetBrowsers: ['chrome'],
  outDir: 'dist',
  vite: () => ({
    ssr: {
      noExternal: ['@webext-core/messaging']
    }
  }),
  manifest: {
    name: 'TeamSpirit 自動入力',
    description:
      'TeamSpirit の勤務表入力をテンプレート化して自動入力します。',
    action: {
      default_title: 'TeamSpirit 自動入力',
    },
    permissions: ['storage', 'scripting'],
    host_permissions: [
      'https://*.teamspirit.co.jp/*',
      'https://*.teamspirit.com/*',
      'https://*.force.com/*',
      'https://*.lightning.force.com/*',
      'https://*.visual.force.com/*',
      'https://*.visualforce.com/*',
      'https://*.salesforce.com/*',
      'https://*.my.salesforce.com/*',
      'https://*.my.site.com/*',
      'https://*.cloudforce.com/*',
    ],
  },
});
