"""Prototype, source-backed event-category estimate endpoint."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.intelligence_service import IntelligenceInputError
from app.predictive_service import PredictiveInputError, predict_historical_categories
from app.schemas import PredictiveRiskRead, PredictiveRiskRequest

router = APIRouter(prefix="/api/predictive-risk", tags=["prototype predictive analytics"])


@router.post("/{active_well_id}", response_model=PredictiveRiskRead)
def get_prototype_risk_estimate(
    active_well_id: UUID,
    payload: PredictiveRiskRequest,
    db: Session = Depends(get_db),
) -> PredictiveRiskRead:
    try:
        return predict_historical_categories(
            db,
            str(active_well_id),
            radius_km=payload.radius_km,
            depth_window_m=payload.depth_window_m,
            active_depth_m=payload.active_depth_m,
            active_formation=payload.active_formation,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (IntelligenceInputError, PredictiveInputError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
