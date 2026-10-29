import client from './client'

export interface WealthMilestone {
  id: number
  name: string
  present_amount: string
  target_year: number
  inflation_rate: string
  expected_return_rate: string
  years_remaining: number
  future_amount: string
  required_monthly_sip: string | null
}

export interface WealthMilestoneInput {
  name: string
  present_amount: string
  target_year: number
  inflation_rate: string
  expected_return_rate: string
}

export interface WealthMilestoneCollection {
  current_year: number
  milestones: WealthMilestone[]
}

export const wealthMilestonesApi = {
  async list(): Promise<WealthMilestoneCollection> {
    const response = await client.get('/wealth/milestones/')
    return response.data.data ?? response.data
  },

  async create(input: WealthMilestoneInput): Promise<WealthMilestone> {
    const response = await client.post('/wealth/milestones/', input)
    return response.data.data ?? response.data
  },

  async update(id: number, input: WealthMilestoneInput): Promise<WealthMilestone> {
    const response = await client.patch(`/wealth/milestones/${id}/`, input)
    return response.data.data ?? response.data
  },

  async delete(id: number): Promise<void> {
    await client.delete(`/wealth/milestones/${id}/`)
  },
}
