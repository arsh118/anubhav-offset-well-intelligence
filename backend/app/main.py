"""FastAPI application entry point."""

import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

from app.alert_api import router as alert_router
from app.api import router
from app.config import settings
from app.document_api import router as document_router
from app.intelligence_api import router as intelligence_router
from app.live_api import router as live_router
from app.predictive_api import router as predictive_router

cors_origins = (
    ["https://anubhav-nwis.vercel.app"]
    if os.getenv("RENDER") == "true"
    else settings.cors_origin_list
)

app = FastAPI(
    title="ANUBHAV API",
    version="0.1.0",
    description=(
        "Offset well knowledge and historical decision support. Results describe historical "
        "precedents and are not accident predictions or safety guarantees."
    ),
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["*"],
)
app.include_router(router)
app.include_router(alert_router)
app.include_router(document_router)
app.include_router(intelligence_router)
app.include_router(live_router)
app.include_router(predictive_router)


@app.exception_handler(IntegrityError)
async def integrity_error_handler(request: Request, exc: IntegrityError) -> JSONResponse:
    del request, exc
    return JSONResponse(
        status_code=409,
        content={"detail": "The requested data conflicts with a database constraint."},
    )
