import { defineStore } from 'pinia'

export type Account = {
  key: string
  name: string
  role: string
  workArea: string
}

// 演示账号：通风负责人按工区隔离，其余角色全平台只读。
export const ACCOUNTS: Account[] = [
  { key: 'lead-1', name: '周通风', role: '通风负责人', workArea: '一工区' },
  { key: 'lead-2', name: '吴换气', role: '通风负责人', workArea: '二工区' },
  { key: 'viewer', name: '值班长', role: '值班长', workArea: '一工区' },
  { key: 'inspector', name: '安检员', role: '安检员', workArea: '一工区' },
]

export const useSessionStore = defineStore('session', {
  state: () => ({
    accountKey: 'lead-1',
    operator: '周通风',
    shiftLabel: '白班 08:00-20:00',
    scope: '盾构隧道掘进施工管理平台',
  }),
  getters: {
    account(): Account {
      return ACCOUNTS.find((item) => item.key === this.accountKey) ?? ACCOUNTS[0]
    },
    canOperate(): boolean {
      return this.operator.length > 0
    },
    isVentLead(): boolean {
      return this.account.role === '通风负责人'
    },
    workArea(): string {
      return this.account.workArea
    },
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    switchAccount(key: string) {
      const target = ACCOUNTS.find((item) => item.key === key)
      if (!target) return
      this.accountKey = target.key
      this.operator = target.name
    },
  },
})
