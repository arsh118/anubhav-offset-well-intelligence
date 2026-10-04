import type { OffsetMatch } from './api'

export const JUDGING_DEMO = {
  activeWellName: 'ANB-01',
  radiusKm: 20,
  depthWindowM: 100,
  knowledgeQuery: 'lost circulation in X Formation',
  precedents: [
    { wellName: 'ANB-02', eventType: 'lost_circulation', depthM: 2865 },
    { wellName: 'ANB-03', eventType: 'torque_spike', depthM: 2830 },
    { wellName: 'ANB-04', eventType: 'lost_circulation', depthM: 2875 },
  ],
} as const

/** Select only these existing, source-backed seed events for the judging spotlight. */
export function getJudgingPrecedents(matches: OffsetMatch[]): OffsetMatch[] {
  return JUDGING_DEMO.precedents.flatMap((expected) => {
    const match = matches.find((item) => item.offset_well.well_name === expected.wellName
      && item.event_type === expected.eventType
      && item.historical_depth_m === expected.depthM)
    return match ? [match] : []
  })
}
