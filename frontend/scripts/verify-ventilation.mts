// 业务规则验证脚本（不入产物）：用 localStorage shim 在 Node 里跑通风领域服务。
import { getSnapshot, refreshReadings, registerUnit, resolveFault, startUnit, stopUnit, updateAirflow, markFault, ventSafetyBrief } from '../src/api/ventilation-service'

const store: Record<string, string> = {}
;(globalThis as any).window = {
  localStorage: {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v },
    removeItem: (k: string) => { delete store[k] },
  },
}

const lead1 = { name: '周通风', role: '通风负责人', workArea: '一工区' }
const lead2 = { name: '吴换气', role: '通风负责人', workArea: '二工区' }
const viewer = { name: '值班长', role: '值班长', workArea: '一工区' }

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${extra}`) }
}

// 1. 首次快照：存量按位置重梳，甲烷 1.62 自动故障、CO 26 报警故障
let snap = getSnapshot()
console.log('存量迁移与自动判故障')
check('共 7 台存量机组', snap.units.length === 7, `实际 ${snap.units.length}`)
const u3 = snap.units.find((u) => u.code === 'VENT-0103')!
const u6 = snap.units.find((u) => u.code === 'VENT-0106')!
check('VENT-0103 甲烷超限自动进故障', u3.status === '故障' && u3.gasBreaches[0].level === '超限')
check('VENT-0106 CO 报警自动进故障', u6.status === '故障' && u6.gasBreaches[0].level === '报警')
check('故障列排在看板最前', snap.columns[0] === '故障')
check('超限机组数=2', snap.gasBreachCount === 2, `实际 ${snap.gasBreachCount}`)
check('温度分箱覆盖 6 台有读数机组（待启动缺测不入箱）', snap.tempDistribution.reduce((s, b) => s + b.count, 0) === 6)
check('值守视图按人分组', snap.keeperGroups.length >= 5)

// 2. 巡检待办与看板同源
console.log('隐患同步与单一数据源')
const brief1 = ventSafetyBrief()
check('巡检侧超限数与看板一致', brief1.breachCount === snap.gasBreachCount)
check('巡检侧生成 2 条通风隐患待办', brief1.hazards.length === 2, `实际 ${brief1.hazards.length}`)
check('隐患单写明超限档位', brief1.hazards.some((h) => String(h['发现问题']).includes('超限档')))
check('隐患含关联机组编号', brief1.hazards.every((h) => String(h['关联机组']).startsWith('VENT-')))

// 3. 重复快照不重复登记隐患
snap = getSnapshot()
const brief2 = ventSafetyBrief()
check('重复读取只留一条隐患/机组', brief2.hazards.length === 2)

// 4. 取数重试：VENT-0102 前 3 轮都失败，每次重试 3 次，不顶新值
console.log('取数失败重试且不顶旧值')
const before = getSnapshot().units.find((u) => u.code === 'VENT-0102')!
const oldCheckedAt = before.checkedAt
const r1 = refreshReadings()
const f1 = r1.results.find((r) => r.code === 'VENT-0102')!
check('首轮取数失败并重试3次', !f1.ok && f1.attempts === 3 && f1.stale)
const after1 = getSnapshot().units.find((u) => u.code === 'VENT-0102')!
check('失败后读数时间未被刷新（未顶上轮）', after1.checkedAt === oldCheckedAt && after1.readOk === false)

// 第 2、3 轮仍然失败（计数器共 3 次失败）
refreshReadings()
const r3 = refreshReadings()
const f3 = r3.results.find((r) => r.code === 'VENT-0102')
check('前三轮全部失败', f3 !== undefined && f3.ok === false)
// 第 4 轮恢复
const r4 = refreshReadings()
const ok4 = r4.results.find((r) => r.code === 'VENT-0102')!
check('第四轮取数成功', ok4.ok && ok4.attempts === 1)
const after4 = getSnapshot().units.find((u) => u.code === 'VENT-0102')!
check('成功后读数时间更新', after4.checkedAt !== oldCheckedAt && after4.readOk === true)

// 5. 权限：非负责人只读、跨工区拒绝
console.log('权限控制')
check('值班长改送风量被拒', !updateAirflow(u3.id, 2000, viewer).ok)
check('二工区负责人改一工区被拒', !updateAirflow(u3.id, 2000, lead2).ok)
check('值班长启动被拒', !startUnit(1, viewer).ok)
check('值班长登记被拒', !registerUnit({ code: 'X', location: 'x', ductLength: 10, airflow: 10, keeper: '' }, viewer).ok)
check('一工区负责人改本工区送风量成功', updateAirflow(u3.id, 1999, lead1).ok)
check('送风量非法值拒绝', !updateAirflow(u3.id, -5, lead1).ok)

// 6. 重复登记只留最早、存不进原样退回
console.log('登记去重')
const dup = registerUnit({ code: 'VENT-0103', location: '重复位', ductLength: 50, airflow: 50, keeper: '甲' }, lead1)
check('重复编号拒绝', !dup.ok)
check('原样退回提交内容', dup.returned?.location === '重复位' && dup.returned.keeper === '甲')
check('台账数量未增加', getSnapshot().units.length === 7)
const reg = registerUnit({ code: 'VENT-0107', location: '一工区·左洞 K2+720', ductLength: 300, airflow: 800, keeper: '张东海' }, lead1)
check('新机组登记成功进入待启动', reg.ok && getSnapshot().units.find((u) => u.code === 'VENT-0107')?.status === '待启动')
const reg2 = registerUnit({ code: 'VENT-0108', location: '', ductLength: 0, airflow: 0, keeper: '' }, lead1)
check('非法登记拒绝并退回', !reg2.ok && reg2.returned?.code === 'VENT-0108')

// 7. 处置恢复 -> 隐患闭环，两处超限数同步下降
console.log('处置闭环')
const res = resolveFault(u3.id, lead1, { methane: 0.2, co: 4, temperature: 30 })
check('处置恢复成功', res.ok)
snap = getSnapshot()
check('处置后机组回到运行中', snap.units.find((u) => u.code === 'VENT-0103')?.status === '运行中')
check('处置后超限机组数下降为 1', snap.gasBreachCount === 1, `实际 ${snap.gasBreachCount}`)
const brief3 = ventSafetyBrief()
check('巡检侧超限数同步为 1', brief3.breachCount === 1)
check('对应隐患已从待办消失', !brief3.hazards.some((h) => h['关联机组'] === 'VENT-0103'))
const entries = JSON.parse(store['shield-tunnel-construction:entries'])
const closedHazard = entries.safety.find((h: Record<string, unknown>) => h['巡检编号'] === 'HAZ-VENT-0103')
check('闭环记录了处置人与时间', closedHazard?.['闭环人'] === '周通风' && Boolean(closedHazard?.['闭环日期']))

// 8. 手动登记故障也进巡检待办
console.log('手动故障联动')
const mf = markFault(1, lead1)
check('手动登记故障成功', mf.ok)
check('巡检待办新增设备故障隐患', ventSafetyBrief().hazards.some((h) => h['关联机组'] === 'VENT-0101'))
// 恢复现场
resolveFault(1, lead1, { methane: 0.1, co: 3, temperature: 27 })

// 9. 超限机组即使被手动停机，下一轮取数核对时仍会被拉回故障待处理
console.log('超限态优先于手动停机')
const target6 = getSnapshot().units.find((u) => u.code === 'VENT-0106')!
stopUnit(target6.id, lead1)
check('手动停机后，超限机组经核对仍回到故障态', getSnapshot().units.find((u) => u.code === 'VENT-0106')?.status === '故障')
// 处置收尾，恢复现场
resolveFault(target6.id, lead1, { methane: 0.2, co: 5, temperature: 30 })

console.log(`\n结果：${pass} 通过，${fail} 失败`)
if (fail > 0) process.exit(1)
