/** 通风运行看板的领域模型：与通用 EntryRow 分开，阈值、版本、权限都围绕这套结构走。 */

/** 机组运行四态：待启动 / 运行中 / 已停机 / 故障 */
export type UnitStatus = '待启动' | '运行中' | '已停机' | '故障'

/** 有害气体档位：未超 / 一档预警 / 二档报警（超过上限，进故障） / 三档险情 */
export type GasLevel = 0 | 1 | 2 | 3

export type GasKind = 'CH4' | 'CO' | 'H2S' | 'CO2'

/** 一次气体读数：成功才有 value；失败时只有 error，不得顶替上一轮读数 */
export type GasSample = {
  unitId: number
  time: number
  /** 成功读数；失败为 null，此时页面继续展示 lastGood 里的上一有效值 */
  value: number | null
  error: string
  /** 本轮失败后已重试次数 */
  attempts: number
}

/** 气体判定结果：value 取最近一次「成功」读数，失败读数不参与档位计算 */
export type GasVerdict = {
  kind: GasKind
  value: number | null
  level: GasLevel
  /** 触发当前档位的阈值（含），无读数或未超时为 null */
  threshold: number | null
  label: string
  spec: { name: string; unit: string; levels: [number, number, number] }
}

/** 隐患处置状态：待处理（超限自动产生）→ 已处置待闭环 → 已闭环 */
export type HazardStatus = '待处理' | '已处置待闭环' | '已闭环'

/** 通风超限隐患待办：与安全巡检页共用同一份 */
export type VentHazard = {
  id: number
  unitId: number
  unitCode: string
  gasKind: GasKind
  gasLabel: string
  level: GasLevel
  levelLabel: string
  /** 触发时读数 */
  value: number
  threshold: number
  zone: string
  raisedAt: number
  status: HazardStatus
  handledBy?: string
  handledAt?: number
  handleNote?: string
  closedBy?: string
  closedAt?: number
}

/** 通风机组 */
export type VentUnit = {
  id: number
  /** 机组编号，业务唯一键，重复登记只留最早那条 */
  code: string
  status: UnitStatus
  /** 安装位置（里程/工区），存量机组要按它重新复核一遍 */
  position: string
  zone: string
  ductLengthM: number
  /** 额定送风量 m³/min */
  ratedAirflow: number
  /** 当前设定送风量 m³/min，仅本工区通风负责人可改 */
  airflow: number
  /** 洞内温度 ℃，最近一次成功读数 */
  temperature: number | null
  operator: string
  /** 各气体最近一次成功读数（失败不覆盖） */
  lastGood: Partial<Record<GasKind, number>>
  lastSampleAt: number | null
  /** 最近一次取数失败信息（成功后置空） */
  readError: string
  /** 自动进故障时的档位说明，如「CH4 二档报警 1.12%（上限1.0%）」 */
  faultReason: string
  /** 首次登记时间，最早那条以此为准 */
  registeredAt: number
  /** 存量机组安装位置复核标记 */
  positionReviewed: boolean
  /** 乐观锁版本：以哪一版作数由「先改成功的那版」决定 */
  version: number
  /** 兼容老数据：迁移来源说明 */
  migratedFromLegacy?: boolean
  note?: string
}

/** 登记/编辑提交载体：重复提交、越权、版本冲突时原样退回 */
export type UnitDraft = {
  code: string
  position: string
  zone: string
  ductLengthM: number
  ratedAirflow: number
  airflow: number
  temperature: number | null
  operator: string
  note?: string
  /** 提交时携带的期望版本；与库内不一致即冲突 */
  expectedVersion?: number
}

export type ServiceResult<T> =
  | { ok: true; data: T; version: number }
  | { ok: false; message: string; reason: 'forbidden' | 'conflict' | 'duplicate' | 'invalid' | 'notfound'; draft?: UnitDraft }

export type RoleId = 'vent-lead-a' | 'vent-lead-b' | 'inspector' | 'viewer'

export type Account = {
  id: RoleId
  name: string
  role: string
  zone: string
  /** 只有本工区的通风负责人能改送风量/操作机组 */
  canControl: boolean
  canCloseHazard: boolean
}
