import { ArrowRight, BookOpen, Check, ClipboardList, MapPinned } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { OffsetMatch, Well } from '../lib/api'
import { formatDepth, formatDistance } from '../lib/format'
import { JUDGING_DEMO } from '../lib/demoScenario'

type Props = {
  activeWell: Well
  precedents: OffsetMatch[]
  onOpenEvidence: (match: OffsetMatch) => void
}

export function DemoScenarioGuide({ activeWell, precedents, onOpenEvidence }: Props) {
  const highestRelevance = precedents.reduce<OffsetMatch | null>((best, match) => !best || match.relevance_score > best.relevance_score ? match : best, null)

  return <section className="demo-guide panel" aria-label="ANB-01 judging demo guide">
    <div className="demo-guide-heading"><div><span className="demo-guide-kicker"><ClipboardList size={13} /> JUDGING WALKTHROUGH · SEEDED RECORDS</span><h2>ANB-01 · Offset intelligence scenario</h2><p>Use the numbered path to show how current context connects to historical evidence and engineer review.</p></div><span className="demo-live-badge"><i /> SEEDED API RECORDS</span></div>
    <div className="demo-guide-grid">
      <article className="demo-guide-step"><span className="demo-step-number">01—04</span><div className="demo-step-icon"><MapPinned size={15} /></div><h3>Establish the context</h3><p><strong>{activeWell.well_name}</strong> · {formatDepth(activeWell.current_depth)} · {activeWell.current_formation?.name ?? 'Formation unavailable'}</p><small>Map: ANB-02 · ANB-03 · ANB-04 · ANB-05 within {JUDGING_DEMO.radiusKm} km.</small><Link to="/active-well">Open active well <ArrowRight size={12} /></Link></article>
      <article className="demo-guide-step"><span className="demo-step-number">05—10</span><div className="demo-step-icon"><Check size={15} /></div><h3>Compare depth and formation</h3><p><strong>{precedents.length} featured precedents</strong> around the active depth in X Formation.</p><small>{precedents.map((match) => `${match.offset_well.well_name} ${formatDepth(match.historical_depth_m)} · ${formatDistance(match.distance_km)}`).join(' / ') || 'Seeded historical matches are unavailable.'} · See Well Correlation and Depth Correlation above.</small><button type="button" className="demo-guide-link" disabled={!highestRelevance} onClick={() => highestRelevance && onOpenEvidence(highestRelevance)}>Open highest relevance evidence <ArrowRight size={12} /></button></article>
      <article className="demo-guide-step"><span className="demo-step-number">11—12</span><div className="demo-step-icon"><BookOpen size={15} /></div><h3>Search institutional memory</h3><p>Search the source-linked knowledge repository with the scenario phrase.</p><small>“{JUDGING_DEMO.knowledgeQuery}”</small><Link to={`/knowledge?q=${encodeURIComponent(JUDGING_DEMO.knowledgeQuery)}`}>Open matching records <ArrowRight size={12} /></Link></article>
      <article className="demo-guide-step"><span className="demo-step-number">13—16</span><div className="demo-step-icon"><Check size={15} /></div><h3>Replay, recommend, review</h3><p>Use Live Intelligence above for the experimental signal and simulated replay. Inspect the alert evidence, recorded mitigation, and recommendation; acknowledge and mark it reviewed.</p><small>Decision support — engineer review required. The replay is not an OIL eRTMAC connection.</small><Link to="/active-well">Open active well alerts <ArrowRight size={12} /></Link></article>
    </div>
    <div className="demo-guide-footer"><strong>ANUBHAV identified a relevant historical precedent.</strong> All signals and excerpts come from the reproducible Representative Synthetic Demo Data seed. The guide spotlights 3 records; other API results remain available in Offset Wells and Knowledge.</div>
  </section>
}
