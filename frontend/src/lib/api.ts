const API_BASE = import.meta.env.PROD
  ? 'https://anubhav-api-6s3x.onrender.com/api'
  : import.meta.env.VITE_API_BASE_URL ?? '/api'

export const INITIAL_API_TIMEOUT_MS = 90_000
export const DASHBOARD_API_TIMEOUT_MS = 75_000
const DEFAULT_API_TIMEOUT_MS = 45_000

export type Formation = { id: string; name: string; normalized_name: string; aliases: string[] }
export type FormationInterval = {
  id: string
  formation_id: string
  formation: Formation
  top_depth: number
  base_depth: number
  depth_unit: string
  lithology: string | null
  geological_zone: string | null
  reservoir_zone: string | null
  pressure_indicator: string | null
  porosity_percent: number | null
  permeability_md: number | null
}
export type DrillingMeasurement = {
  id: string
  well_id: string
  sampled_at: string
  measured_depth_m: number
  true_vertical_depth_m: number | null
  mud_weight_sg: number | null
  ecd_sg: number | null
  rop_m_per_hr: number | null
  wob_kn: number | null
  rpm: number | null
  torque_knm: number | null
  standpipe_pressure_mpa: number | null
  inclination_deg: number | null
  azimuth_deg: number | null
  casing_depth_m: number | null
  cementing_metadata: string | null
  source: string
  created_at: string
  updated_at: string
}
export type Well = {
  id: string
  well_name: string
  field: string | null
  latitude: number | null
  longitude: number | null
  spud_date: string | null
  completion_date: string | null
  total_depth: number | null
  current_depth: number | null
  current_formation: Formation | null
  formations: FormationInterval[]
  role: 'active' | 'offset'
  status: string
  source: string
}
export type Document = {
  id: string
  well_id: string
  filename: string
  document_type: string
  source: string
  origin: 'seeded_demo' | 'uploaded_document'
  source_label: string
  uploaded_at: string
  processing_status: 'uploaded' | 'processing' | 'processed' | 'failed'
  page_count: number | null
}
export type Evidence = {
  id: string
  event_id: string
  document_id: string
  page_number: number | null
  excerpt: string
  extraction_method: string
  confidence: number
  document: Document
}
export type WellEvent = {
  id: string
  well_id: string
  well_name: string
  event_type: string
  event_title: string
  description: string
  measured_depth: number | null
  true_vertical_depth: number | null
  formation: Formation | null
  event_date: string | null
  consequence: string | null
  mitigation: string | null
  severity_label: string
  source_document_id: string
  source_page: number | null
  confidence: number
  source_document: Document
  evidence: Evidence[]
}
export type NearbyWell = { well: Well; distance_km: number; formation_match: boolean | null }
export type OffsetWellSummary = {
  id: string
  well_name: string
  field: string | null
  formation_name?: string | null
  latitude: number | null
  longitude: number | null
  distance_km: number
  matching_event_count: number
  best_relevance_score: number
  event_ids: string[]
}
export type OffsetWellsRead = {
  active_well: Correlation['active_well']
  radius_km: number
  depth_window_m: number
  event_family: string | null
  heuristic_weights: Record<string, number>
  offsets: OffsetWellSummary[]
  total_matching_events: number
  message: string | null
}
export type OffsetMatch = {
  event_id: string
  offset_well: { id: string; well_name: string; field: string | null; latitude: number | null; longitude: number | null }
  distance_km: number
  historical_depth_m: number
  active_depth_m: number
  depth_difference_m: number
  absolute_depth_difference_m: number
  depth_band: string
  formation: Formation | null
  formation_match: string
  event_type: string
  event_title: string
  description: string
  consequence: string | null
  mitigation: string | null
  relevance_score: number
  relevance_score_normalized: number
  relevance_band: string
  components: Record<string, { score: number; weight: number }>
  source_document: Document
  source_page: number | null
  evidence_excerpt: string
  source_confidence: number
  existing_alert: { id: string; status: AlertStatus } | null
  explanation: string
}
export type Correlation = {
  active_well: { id: string; well_name: string; field: string | null; latitude: number | null; longitude: number | null; active_depth_m: number | null; active_formation: string | null }
  radius_km: number
  depth_window_m: number
  heuristic_weights: Record<string, number>
  matched_wells: OffsetWellSummary[]
  historical_events: OffsetMatch[]
  total_matching_events: number
  active_formation_interval: FormationInterval | null
  active_drilling_parameters: DrillingMeasurement | null
  comparable_wells: WellCorrelationComparison[]
  data_notice: string
  message: string | null
}
export type ParameterComparison = { active_value: number | null; offset_value: number | null; difference: number | null; unit: string }
export type WellCorrelationComparison = {
  offset_well: Well
  distance_km: number
  depth_alignment_m: number | null
  formation_match: 'exact' | 'alias' | 'mismatch' | 'unknown'
  active_formation_interval: FormationInterval | null
  offset_formation_interval: FormationInterval | null
  geological_similarity: number | null
  reservoir_similarity: number | null
  active_drilling_parameters: DrillingMeasurement | null
  offset_drilling_parameters: DrillingMeasurement | null
  drilling_parameter_comparison: Record<string, ParameterComparison>
  historical_events: OffsetMatch[]
  comparison_reasons: string[]
  source_label: string
}
export type Signals = {
  active_well: Correlation['active_well']
  radius_km: number
  depth_window_m: number
  summary: {
    matched_offset_wells: number
    matched_historical_events: number
    high_relevance_signals: number
    medium_relevance_signals: number
    low_relevance_matches: number
    top_relevance_score: number | null
    has_significant_match: boolean
  }
  signals: OffsetMatch[]
  message: string | null
  data_notice: string
}
export type AlertStatus = 'open' | 'acknowledged' | 'reviewed' | 'dismissed'
export type AlertNote = { id: string; alert_id: string; note: string; author: string | null; created_at: string }
export type Alert = {
  id: string
  active_well_id: string
  historical_event_id: string
  alert_type: string
  alert_title: string
  relevance_score: number
  explanation: string
  distance_km: number | null
  depth_difference_m: number | null
  formation_match: boolean | null
  status: AlertStatus
  created_at: string
  updated_at: string
  active_well?: Well
  historical_event?: WellEvent
  notes?: AlertNote[]
}
export type ActiveAlerts = {
  active_well: Correlation['active_well']
  category: 'high_historical_relevance' | 'medium_historical_relevance' | 'no_significant_precedent'
  title: string
  summary: string
  radius_km: number
  future_depth_window_m: number
  relevance_threshold: number
  matching_event_count: number
  alerts: Alert[]
  recommendation: EvidenceBackedRecommendation | null
}
export type EvidenceBackedRecommendation = {
  label: string
  message: string
  reason: string
  source_event_id: string
  source_event_title: string
  source_well_name: string
  source_document: string
  source_page: number | null
  evidence_excerpt: string
  recorded_mitigation: string
}
export type LiveState = { measurement: DrillingMeasurement; formation: string | null; pressure_indicator: string | null }
export type LiveFeed = {
  well_id: string
  well_name: string
  feed_type: string
  status: string
  states: LiveState[]
  message: string | null
  data_notice: string
}
export type PredictiveFeatureContribution = { feature: string; value: number; contribution: number; explanation: string }
export type PredictiveRiskSignal = {
  risk_type: string
  probability: number
  risk_band: string
  top_contributing_features: PredictiveFeatureContribution[]
  supporting_offset_wells: string[]
  supporting_historical_events: OffsetMatch[]
}
export type PredictiveRisk = {
  active_well_id: string
  active_well_name: string
  status: 'available' | 'insufficient_data'
  model_name: string
  model_version: string
  model_metadata: Record<string, unknown>
  training_sample_count: number
  signals: PredictiveRiskSignal[]
  message: string | null
  notice: string
}
export type DocumentProcess = { document: Document; events: WellEvent[]; processing_mode: string; extracted_pages: number; ocr_pages: number; message: string }

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.name = 'ApiError'; this.status = status }
}

export async function withTransientRetries<T>(operation: () => Promise<T>, maxRetries = 2): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      const status = error instanceof ApiError ? error.status : null
      const transient = status === 0 || status === 408 || status === 429 || (status !== null && status >= 500)
      if (!transient || attempt >= maxRetries) throw error
      await new Promise<void>((resolve) => window.setTimeout(resolve, 1_000 * 2 ** attempt))
    }
  }
}

export async function api<T>(path: string, options: RequestInit = {}, timeoutMs = DEFAULT_API_TIMEOUT_MS): Promise<T> {
  const timeoutController = new AbortController()
  const externalSignal = options.signal
  let timedOut = false
  const timeout = window.setTimeout(() => {
    timedOut = true
    timeoutController.abort()
  }, timeoutMs)
  const forwardAbort = () => timeoutController.abort(externalSignal?.reason)
  if (externalSignal?.aborted) forwardAbort()
  else externalSignal?.addEventListener('abort', forwardAbort, { once: true })

  let response: Response
  try {
    try {
      response = await fetch(`${API_BASE}${path}`, { ...options, signal: timeoutController.signal })
    } catch (error) {
      if (externalSignal?.aborted) throw error
      if (timedOut) throw new ApiError('ANUBHAV is taking longer to respond. Please try again.', 0)
      throw new ApiError('The ANUBHAV API could not be reached. Check your connection and try again.', 0)
    }
    if (!response.ok) {
      let message = `Request failed (${response.status}).`
      try {
        const body = await response.json() as { detail?: unknown }
        if (typeof body.detail === 'string' && body.detail.trim()) {
          message = body.detail.trim()
        } else if (Array.isArray(body.detail)) {
          const validationMessages = body.detail.flatMap((item: unknown) => {
            if (typeof item !== 'object' || item === null || !('msg' in item)) return []
            const detailMessage = item.msg
            return typeof detailMessage === 'string' && detailMessage.trim() ? [detailMessage.trim()] : []
          })
          if (validationMessages.length > 0) message = validationMessages.join(' · ')
        }
      } catch { /* Keep the readable fallback. */ }
      throw new ApiError(message, response.status)
    }
    try {
      return await response.json() as T
    } catch {
      if (timedOut) throw new ApiError('ANUBHAV is taking longer to respond. Please try again.', 0)
      throw new ApiError('The ANUBHAV API returned an unreadable response.', response.status)
    }
  } finally {
    window.clearTimeout(timeout)
    externalSignal?.removeEventListener('abort', forwardAbort)
  }
}

export function queryString(values: Record<string, string | number | undefined | null>): string {
  const query = new URLSearchParams()
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
  })
  const serialized = query.toString()
  return serialized ? `?${serialized}` : ''
}
