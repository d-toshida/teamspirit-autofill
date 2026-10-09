import { defineConfig } from 'wxt';
import { TEAMSPIRIT_HOST_MATCHES } from './lib/hosts.js';

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
    host_permissions: TEAMSPIRIT_HOST_MATCHES,
  },
});
