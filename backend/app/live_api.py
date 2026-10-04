"""Deterministic simulated drilling replay; this router does not connect to eRTMAC."""

from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.models import DrillingMeasurement, Well, WellFormationInterval
from app.schemas import DrillingMeasurementRead, LiveDrillingState, LiveFeedRead

router = APIRouter(prefix="/api/live", tags=["simulated live feed"])


@router.get("/{well_id}", response_model=LiveFeedRead)
def get_simulated_feed(
    well_id: UUID,
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
) -> LiveFeedRead:
    well = db.scalar(
        select(Well)
        .where(Well.id == str(well_id))
        .options(selectinload(Well.formation_intervals).selectinload(WellFormationInterval.formation))
    )
    if well is None:
        raise HTTPException(status_code=404, detail="Well not found")
    measurements: List[DrillingMeasurement] = list(
        db.scalars(
            select(DrillingMeasurement)
            .where(DrillingMeasurement.well_id == str(well_id))
            .order_by(DrillingMeasurement.sampled_at, DrillingMeasurement.measured_depth_m)
            .limit(limit)
        ).all()
    )
    states = []
    for measurement in measurements:
        depth = float(measurement.measured_depth_m)
        interval = next(
            (
                row
                for row in well.formation_intervals
                if float(row.top_depth) <= depth <= float(row.base_depth)
            ),
            None,
        )
        states.append(
            LiveDrillingState(
                measurement=DrillingMeasurementRead.model_validate(measurement),
                formation=interval.formation.name if interval else None,
                pressure_indicator=interval.pressure_indicator if interval else None,
            )
        )
    return LiveFeedRead(
        well_id=well_id,
        well_name=well.well_name,
        states=states,
        message=(None if states else "No seeded measurement sequence is available for this well."),
    )
