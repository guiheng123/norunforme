import { createRouter, createWebHistory } from 'vue-router'
import { hasSession } from './store'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('./pages/LoginPage.vue'),
      meta: { title: '登录', bare: true },
    },
    {
      path: '/',
      name: 'overview',
      component: () => import('./pages/HomePage.vue'),
      meta: { title: '概览' },
    },
    {
      path: '/records',
      name: 'records',
      component: () => import('./pages/RecordsPage.vue'),
      meta: { title: '跑步记录' },
    },
    {
      path: '/records/:id',
      name: 'record-detail',
      component: () => import('./pages/RecordDetailPage.vue'),
      meta: { title: '记录详情' },
    },
    {
      path: '/simulate',
      name: 'simulate',
      component: () => import('./pages/SimulatePage.vue'),
      meta: { title: '模拟跑步' },
    },
    {
      path: '/device',
      name: 'device',
      component: () => import('./pages/DevicePage.vue'),
      meta: { title: '设备控制台' },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('./pages/SettingsPage.vue'),
      meta: { title: '设置' },
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach((to) => {
  const authed = hasSession()
  if (!authed && to.name !== 'login') {
    return { name: 'login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : undefined }
  }
  if (authed && to.name === 'login') {
    return { name: 'overview' }
  }
  return true
})
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣

router.afterEach((to) => {
  const title = String(to.meta.title ?? '控制台')
  document.title = title === '登录' ? '登录 · 乐跑控制台' : `${title} · 乐跑控制台`
})

export default router
