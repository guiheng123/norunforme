import type { Profile, SessionMeta } from '../api/types'

export const DEMO_TOKEN = 'demo-token-only-for-offline-ui'
export const DEMO_UID = 10000001
export const DEMO_STUDENT_NUM = '2026000000001'

export const DEMO_SCHOOL_STORAGE_KEY = 'lepao.web.demoSchool'

let memoryDemoKey = ''

export interface DemoCheckpoint {
  id: string
  name: string
  lat: number
  lng: number
}

export interface DemoSchool {
  key: string
  id: number
  name: string
  zoneId: string
  zoneName: string
  center: { lat: number; lng: number }
  rx: number
  ry: number
  minLogNum: number
  checkpoints: DemoCheckpoint[]
}

function cp(id: string, name: string, lat: number, lng: number): DemoCheckpoint {
  return { id, name, lat, lng }
}

export const DEMO_SCHOOLS: DemoSchool[] = [
  {
    key: 'south',
    id: 305,
    name: '南山校区',
    zoneId: '305',
    zoneName: '南山校区 · 学生跑区',
    center: { lat: 22.53332, lng: 113.93041 },
    rx: 0.00161,
    ry: 0.00142,
    minLogNum: 3,
    checkpoints: [
      cp('4201', '科技楼连廊', 22.534218, 113.931126),
      cp('4202', '田径场西门', 22.532702, 113.929018),
      cp('4203', '北门岗亭', 22.534911, 113.929602),
      cp('4204', '图书馆台阶', 22.533104, 113.932214),
      cp('4205', '体育馆南侧', 22.531908, 113.930871),
    ],
  },
  {
    key: 'north',
    id: 412,
    name: '学院路校区',
    zoneId: '412',
    zoneName: '学院路校区 · 学生跑区',
    center: { lat: 39.98193, lng: 116.35203 },
    rx: 0.00158,
    ry: 0.00119,
    minLogNum: 2,
    checkpoints: [
      cp('5301', '主楼前广场', 39.982517, 116.352924),
      cp('5302', '图书馆西侧', 39.982104, 116.350712),
      cp('5303', '东门过街天桥', 39.980308, 116.354118),
      cp('5304', '第一操场', 39.981512, 116.349804),
      cp('5305', '研究生公寓', 39.983206, 116.351228),
    ],
  },
]

export function isDemoToken(token: string | undefined | null): boolean {
  return String(token ?? '').trim().startsWith('demo-token')
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function normalizeDemoKey(key: string | null | undefined): string {
  const raw = String(key ?? '').trim()
  if (!raw) return DEMO_SCHOOLS[0].key
  const byKey = DEMO_SCHOOLS.find((s) => s.key === raw)
  if (byKey) return byKey.key
  const byId = DEMO_SCHOOLS.find((s) => String(s.id) === raw || s.zoneId === raw)
  if (byId) return byId.key
  const byName = DEMO_SCHOOLS.find((s) => s.name === raw || s.zoneName === raw)
  return byName ? byName.key : DEMO_SCHOOLS[0].key
}

export function currentDemoSchoolKey(): string {
  if (memoryDemoKey) return memoryDemoKey
  const s = storage()
  let raw = ''
  try {
    raw = s ? s.getItem(DEMO_SCHOOL_STORAGE_KEY) ?? '' : ''
  } catch {
    raw = ''
  }
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
  memoryDemoKey = normalizeDemoKey(raw)
  return memoryDemoKey
}

export function setDemoSchoolKey(key: string): string {
  const next = normalizeDemoKey(key)
  memoryDemoKey = next
  const s = storage()
  try {
    if (s) s.setItem(DEMO_SCHOOL_STORAGE_KEY, next)
  } catch {
  }
  return next
}

export function demoSchoolByKey(key: string | null | undefined): DemoSchool {
  const k = normalizeDemoKey(key)
  return DEMO_SCHOOLS.find((s) => s.key === k) ?? DEMO_SCHOOLS[0]
}

export function currentDemoSchool(): DemoSchool {
  return demoSchoolByKey(currentDemoSchoolKey())
}

export function demoSchoolByInput(input: unknown): DemoSchool {
  return demoSchoolByKey(typeof input === 'string' || typeof input === 'number' ? String(input) : '')
}

export function demoSession(school: DemoSchool = currentDemoSchool()): SessionMeta {
  return {
    token: DEMO_TOKEN,
    uid: DEMO_UID,
    school_id: school.id,
    student_num: DEMO_STUDENT_NUM,
    mobileModel: 'DEMO-Web',
    mobileDeviceId: '00000000-0000-0000-0000-000000000000',
    mobileOsVersion: '15',
    demo: true,
    zone_id: school.zoneId,
    run_zone_id: school.zoneId,
    zone_name: school.zoneName,
  }
}

const DEMO_STATS: Record<string, { num: number; km: number; weekNum: number; weekKm: number }> = {
  south: { num: 22, km: 81.6, weekNum: 4, weekKm: 14.32 },
  north: { num: 11, km: 35.77, weekNum: 1, weekKm: 3.48 },
}

export function demoProfile(school: DemoSchool = currentDemoSchool()): Profile {
  const stat = DEMO_STATS[school.key] ?? { num: 0, km: 0, weekNum: 0, weekKm: 0 }
  return {
    nick_name: `演示账号 · ${school.name}`,
    school_name: school.name,
    avatar: '',
    total_valid_num: stat.num,
    total_valid_distance: stat.km,
    week_num: stat.weekNum,
    week_distance: stat.weekKm,
  }
}
