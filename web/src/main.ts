import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { toast } from './lib/toast'
import { initBuildTag } from './lib/attest'
import { installNoticeGuard } from './lib/notice-guard'
import './styles/theme.css'

initBuildTag()
installNoticeGuard()

const app = createApp(App)
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣

app.config.errorHandler = (err, _instance, info) => {
  console.error('[lepao] render error:', info, err)
  toast('页面渲染出现异常，已记录到控制台', 'danger')
}

window.addEventListener('unhandledrejection', (event) => {
  console.error('[lepao] unhandled rejection:', event.reason)
  event.preventDefault()
})

app.use(router)
app.mount('#app')
