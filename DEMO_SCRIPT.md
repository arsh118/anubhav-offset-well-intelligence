# ANUBHAV — SIH26121 judging walkthrough

**Primary scenario:** ANB-01 at 2,842 m MD in X Formation, with a 20 km radius and 100 m historical depth window. The application displays **Representative Synthetic Demo Data**. Its live panel is a deterministic simulation and is **not connected to OIL's actual eRTMAC system**.

## 0:00–0:20 — Dashboard and active well

Select **Start demo**. Show ANB-01, 2,842 m MD, X Formation, and the configured radius/window.

**Say:** “The dashboard ties the current well context to nearby historical records. This judging environment uses representative synthetic records and is not an OIL system connection.”

## 0:20–0:45 — Nearby-well map

Show the Dashboard map or open **Offset Wells**. Point out ANB-02, ANB-03, ANB-04, and ANB-05 inside the 20 km radius, then select ANB-02 at approximately 4.2 km.

**Say:** “The map and list are driven by the same nearby-well API and use the selected radius. The coordinates and distances in this demo are illustrative.”

## 0:45–1:15 — Correlation, events, and depth

Show the **Well Correlation** panel and **Depth Correlation**. Point out the X Formation match and the historical ANB-02 lost-circulation event at 2,865 m, 23 m ahead. Open its evidence.

**Say:** “The correlation explains why this offset was surfaced: formation, depth, distance, available geology/reservoir and drilling measurements, plus a source-linked historical event. Depth values are treated as comparable measured-depth meters for this synthetic scenario.”

## 1:15–1:45 — Predictive signal and simulated live monitoring

Return to the Dashboard **Live Intelligence** panel. State the prototype model notice and engineer-review requirement. Click **Start live monitoring**. The fixed replay advances through seeded measurement states; the historical precedent alert is based on the current replay depth and configured window.

**Say:** “This is an experimental Logistic Regression signal trained only on representative synthetic seed events. Evaluation is limited by the small dataset. It is not an OIL-approved model or an incident probability. The replay is explicitly simulated and has no eRTMAC connection.”

## 1:45–2:20 — Historical precedent, evidence, mitigation, recommendation

Show **HISTORICAL PRECEDENT ALERT** at ANB-01's initial 2,842 m state: ANB-02, Lost Circulation, X Formation, 2,865 m, 4.2 km away, 23 m ahead. Open **View source evidence and recorded mitigation**. Read the stored source excerpt, document/page, and recorded mitigation. Point to the recommendation and its reason/source references.

**Say:** “Relevant historical precedent detected ahead in the same formation. The recommendation only asks the engineer to review the documented mitigation and current conditions. It does not prescribe an action or say a failure will occur.”

## 2:20–2:40 — Search the knowledge repository

Open **Knowledge** from the dashboard guide and search `lost circulation in X Formation`. Show event, well, depth, formation, challenge summary, recorded mitigation, source document/page, and evidence. Optionally try `stuck pipe`, `cementing`, or `mud losses`.

**Say:** “Search uses the existing structured event and evidence records. It does not call a paid LLM and does not claim semantic search over original PDF binaries.”

## 2:40–3:00 — Acknowledge and review

Open the historical alert evidence drawer or **Alerts**. Click **Acknowledge**, then **Mark reviewed**. Point out the persisted status and source evidence.

**Close with:** “ANUBHAV makes source-linked historical context easier to find and review. It is decision support for an engineer, not an automated drilling decision.”

## Alternative seeded scenarios

- **ANB-06:** nearby ANB-07 stuck-pipe precedent.
- **ANB-08:** nearby ANB-09 cementing precedent.
- **ANB-10:** nearby wells exist, but no significant historical precedent matches the current depth/formation context.

Every scenario uses the same APIs and source-linked evidence model. Alert relevance is deterministic and heuristic; the prototype's thresholds are not expert-validated limits.
