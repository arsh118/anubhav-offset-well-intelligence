"""Application settings loaded from environment variables and an optional .env file."""

from urllib.parse import urlsplit

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Safe local fallback. Shared runs should set DATABASE_URL explicitly.
    database_url: str = "sqlite:///./anubhav.db"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    upload_dir: str = "./data/uploads"
    cors_allowed_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # Initial offset relevance heuristic. These weights are prototype defaults,
    # not an OIL-approved formula. The scoring service normalizes their sum.
    offset_default_radius_km: float = Field(default=10.0, gt=0, le=50)
    offset_default_depth_window_m: float = Field(default=100.0, gt=0, le=1000)
    offset_depth_high_max_m: float = Field(default=25.0, gt=0)
    offset_depth_medium_max_m: float = Field(default=50.0, gt=0)
    offset_depth_low_max_m: float = Field(default=100.0, gt=0)
    offset_formation_weight: float = Field(default=0.30, ge=0)
    offset_depth_weight: float = Field(default=0.25, ge=0)
    offset_spatial_weight: float = Field(default=0.20, ge=0)
    offset_event_weight: float = Field(default=0.15, ge=0)
    offset_source_confidence_weight: float = Field(default=0.10, ge=0)
    offset_formation_alias_score: float = Field(default=0.85, ge=0, le=1)
    offset_related_event_score: float = Field(default=0.50, ge=0, le=1)
    offset_high_relevance_min_score: float = Field(default=0.75, ge=0, le=1)
    offset_medium_relevance_min_score: float = Field(default=0.50, ge=0, le=1)

    @field_validator("cors_allowed_origins")
    @classmethod
    def validate_cors_allowed_origins(cls, value: str) -> str:
        origins = [origin.strip().rstrip("/") for origin in value.split(",") if origin.strip()]
        if not origins or "*" in origins:
            raise ValueError("CORS_ALLOWED_ORIGINS must contain explicit origins; wildcard origins are not allowed.")
        for origin in origins:
            parsed = urlsplit(origin)
            if (
                parsed.scheme not in {"http", "https"}
                or not parsed.hostname
                or parsed.username
                or parsed.password
                or parsed.path
                or parsed.query
                or parsed.fragment
            ):
                raise ValueError("CORS_ALLOWED_ORIGINS entries must be HTTP(S) origins without paths or queries.")
        return ",".join(origins)

    @property
    def cors_origin_list(self) -> list[str]:
        return self.cors_allowed_origins.split(",")

    @model_validator(mode="after")
    def validate_offset_heuristics(self) -> "Settings":
        weights = (
            self.offset_formation_weight,
            self.offset_depth_weight,
            self.offset_spatial_weight,
            self.offset_event_weight,
            self.offset_source_confidence_weight,
        )
        if sum(weights) <= 0:
            raise ValueError("At least one offset relevance weight must be greater than zero.")
        if not (self.offset_depth_high_max_m <= self.offset_depth_medium_max_m <= self.offset_depth_low_max_m):
            raise ValueError("Offset depth band thresholds must be ordered high <= medium <= low.")
        if self.offset_high_relevance_min_score < self.offset_medium_relevance_min_score:
            raise ValueError("The high relevance threshold must be greater than or equal to the medium threshold.")
        return self

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()
