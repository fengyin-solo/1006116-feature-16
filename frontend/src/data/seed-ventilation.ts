import type { VentStatus } from './ventilation-model'
import type { EntryRow } from './types'

/**
 * 存量通风机组台账：按安装位置从洞口到掌子面重新梳理过一遍。
 * 字段口径见 ventilation-model.ts（阈值版本 v1）。
 * 甲烷单位 %（体积分数），一氧化碳单位 ppm，风筒长度 m，送风量 m³/min。
 */
type SeedVent = {
  id: number
  code: string
  status: VentStatus
  pending: boolean
  abnormal: boolean
  location: string
  duct: number
  airflow: number
  temp: number | string
  methane: number | string
  co: number | string
  checkedAt: string
  keeper: string
  workArea: string
}

const SEED_VENT: SeedVent[] = [
  {
    id: 1,
    code: 'VENT-0101',
    status: '运行中',
    pending: false,
    abnormal: false,
    location: '一工区·洞口主风机站',
    duct: 1200,
    airflow: 1800,
    temp: 27.4,
    methane: 0.12,
    co: 3,
    checkedAt: '2026-10-05 08:30',
    keeper: '王守仁',
    workArea: '一工区',
  },
  {
    id: 2,
    code: 'VENT-0102',
    status: '运行中',
    pending: false,
    abnormal: false,
    location: '一工区·右洞 K2+350 接力风机',
    duct: 860,
    airflow: 1250,
    temp: 30.2,
    methane: 0.31,
    co: 8,
    checkedAt: '2026-10-05 08:30',
    keeper: '李建国',
    workArea: '一工区',
  },
  {
    id: 3,
    code: 'VENT-0103',
    status: '运行中',
    pending: false,
    abnormal: false,
    location: '一工区·左洞掌子面 K2+610',
    duct: 1280,
    airflow: 1500,
    temp: 33.6,
    // 甲烷 1.62%：超过报警上限 1.0% 的 1.5 倍，属“超限”档，首次取数即自动转故障。
    methane: 1.62,
    co: 9,
    checkedAt: '2026-10-05 08:30',
    keeper: '张东海',
    workArea: '一工区',
  },
  {
    id: 4,
    code: 'VENT-0104',
    status: '待启动',
    pending: true,
    abnormal: false,
    location: '一工区·横通道 H2 备用风机位',
    duct: 420,
    airflow: 900,
    temp: '',
    methane: '',
    co: '',
    checkedAt: '',
    keeper: '赵援朝',
    workArea: '一工区',
  },
  {
    id: 5,
    code: 'VENT-0105',
    status: '已停机',
    pending: false,
    abnormal: false,
    location: '一工区·左洞 K2+120 旧风机位',
    duct: 640,
    airflow: 700,
    temp: 29.1,
    methane: 0.18,
    co: 5,
    checkedAt: '2026-10-04 20:10',
    keeper: '王守仁',
    workArea: '一工区',
  },
  {
    id: 6,
    code: 'VENT-0106',
    status: '运行中',
    pending: false,
    abnormal: false,
    location: '一工区·右洞掌子面 K2+580',
    duct: 1150,
    airflow: 1320,
    temp: 36.2,
    methane: 0.42,
    // CO 29 ppm：达到 24 报警线、未到 36（1.5 倍），属“报警”档。
    co: 29,
    checkedAt: '2026-10-05 08:30',
    keeper: '李建国',
    workArea: '一工区',
  },
  {
    id: 7,
    code: 'VENT-0201',
    status: '运行中',
    pending: false,
    abnormal: false,
    location: '二工区·斜井口主风机站',
    duct: 980,
    airflow: 1600,
    temp: 31.5,
    methane: 0.09,
    co: 2,
    checkedAt: '2026-10-05 08:30',
    keeper: '陈立群',
    workArea: '二工区',
  },
]

export const SEED_VENTILATION: EntryRow[] = SEED_VENT.map((item) => ({
  id: item.id,
  status: item.status,
  pending: item.pending,
  abnormal: item.abnormal,
  机组编号: item.code,
  安装位置: item.location,
  风筒长度: item.duct,
  送风量: item.airflow,
  洞内温度: item.temp,
  甲烷: item.methane,
  有害气体浓度: item.methane, // 兼容老字段：老页面若还读这个字段，拿到的是同一份甲烷读数
  一氧化碳: item.co,
  检测日期: item.checkedAt,
  读数状态: '成功',
  值守人员: item.keeper,
  所属工区: item.workArea,
}))
