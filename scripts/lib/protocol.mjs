export const KNOWN_ENDPOINTS = {
  run: [
    'Run/AddTestPoints', 'Run/DelTestPoints', 'Run/GetAllZone', 'Run/GetZonePoints',
    'Run/RollbackDel', 'Run/StatusToDel', 'Run/UpdateTestPoints', 'Run/addRunComplain',
    'Run/getDeepknowInfo', 'Run/getGeeInfo', 'Run/getRank', 'Run/getTimestampV278',
    'Run/getTotalRank', 'Run/recordDetailV270', 'Run/runScore', 'Run/setRunLocationRecord',
    'Run/setRunZone', 'Run/stopFreeRunV220', 'Run/stopRunV278', 'Run/uploadRunRecord',
  ],
  run2: [
    'Run2/addSchFaceInfo', 'Run2/addUserRelDevice', 'Run2/allRecordList', 'Run2/beforeRunV260',
    'Run2/checkSlipCode', 'Run2/checkUserDeviceV278', 'Run2/checkUserPassword',
    'Run2/faceVerify', 'Run2/getCaptureStatus', 'Run2/getDeviceCheckInfo',
    'Run2/getStudentVenaPoint', 'Run2/getVenaPointInfo', 'Run2/getZfbFaceVerifyRecord',
    'Run2/gyroscope', 'Run2/reportCheating', 'Run2/simVerify',
  ],
}

export const STEPS = {
  before: {
    order: 10,
    label: '跑前校验（分配跑区/打卡点/规则）',
    channel: 5,
    method: 'POST',
    candidates: ['Run2/beforeRunV260'],
    required: false,
    build: ({ S, zoneId, lat, lng, date, yearNum }) => ({
      run_zone_id: String(zoneId ?? ''),
      zone_id: String(zoneId ?? ''),
      latitude: Number(lat),
      longtitude: Number(lng),
      longitude: Number(lng),
      date: date ?? new Date().toISOString().slice(0, 10),
      year_num: Number(yearNum ?? new Date().getFullYear()),
    }),
  },

  start: {
    order: 20,
    label: '开始跑步（本地动作，无服务器接口）',
    channel: 1,
    method: null,
    candidates: [],
    local: true,
    build: () => ({}),
  },

  ts: {
    order: 30,
    label: '服务端时间校准（time 风控开时必走）',
    channel: 5,
    method: 'POST',
    candidates: ['Run/getTimestampV278'],
    required: false,
    build: () => ({}),
  },

  sim: {
    order: 35,
    label: '模拟器检测自查',
    channel: 1,
    method: 'POST',
    candidates: ['Run2/simVerify'],
    required: false,
    build: ({ S }) => ({
      mobile_model: S.mobileModel,
      mobile_device_id: S.mobileDeviceId,
      mobile_os_version: S.mobileOsVersion,
    }),
  },

  loc: {
    order: 40,
    label: '途经点上报（跑步中每 ~60s 一次）',
    channel: 5,
    method: 'POST',
    candidates: ['Run/setRunLocationRecord'],
    required: false,
    build: ({ lat, lng, zoneNum, hits }) => ({
      latitude: Number(Number(lat).toFixed(6)),
      longitude: Number(Number(lng).toFixed(6)),
      game_id: Number(zoneNum ?? 1),
      point_ids: (hits ?? [])
        .map((h) => String(h.id ?? h.point_id ?? ''))
        .filter(Boolean)
        .join(','),
    }),
  },

  oss: {
    order: 45,
    label: '取 OSS 上传凭证（report/getOssSts）',
    channel: 5,
    method: 'POST',
    candidates: ['report/getOssSts'],
    required: false,
    build: () => ({}),
  },

  stop: {
    order: 50,
    label: '结束跑步（服务端结算并落记录）',
    channel: 5,
    method: 'POST',
    candidates: ['Run/stopRunV278', 'Run/stopFreeRunV220'],
    required: true,
    build: ({ meta, zoneId, zoneNum, stepNum, startTime, endTime, trackBody, runRecordUrl }) => {
      const body = {
        run_zone_id: String(zoneId ?? ''),
        zone_id: String(zoneId ?? ''),
        game_id: Number(zoneNum ?? zoneId ?? 1),
        distance: Number((meta.distanceKm ?? 0).toFixed(2)),
        time: Number(meta.duration),
        use_time: Number(meta.duration),
//⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
        start_time: Number(startTime ?? meta.startTime),
        end_time: Number(endTime ?? meta.endTime),
        step_num: Number(stepNum ?? 0),
        year_num: new Date(Number(startTime ?? meta.startTime) * 1000).getFullYear(),
        is_save: 1,
      }
      if (trackBody) body.track = String(trackBody)
      if (runRecordUrl) body.file = String(runRecordUrl)
      return body
    },
  },

  upload: {
    order: 60,
    label: '（无独立上传接口，轨迹随 stop 提交）',
    channel: 5,
    method: null,
    candidates: [],
    local: true,
    build: () => ({}),
  },
}

export const STEP_ORDER = Object.entries(STEPS)
  .sort((a, b) => a[1].order - b[1].order)
  .map(([k]) => k)

export const PARAM_ERROR_HINTS = ['参数', '非法', '缺少', '不能为空', '错误']

export const AUTH_HINTS = ['登录', '下线', 'token', '未授权', '失效', '重新登录']

export const NO_ENDPOINT_HINTS = ['模块不存在', 'Not Found', '404']
