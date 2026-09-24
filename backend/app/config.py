import os

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Backend configuration, loaded from environment / the `.env` file."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./cashbook.db"

    jwt_secret: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 30  # 30 days

    # Fernet key(s) for application-level field encryption (see app/crypto.py).
    # Comma-separated for rotation ("newkey,oldkey"). Required in production;
    # a dev fallback is used when blank and DEBUG is on.
    app_encryption_key: str = ""

    public_base_url: str = "http://10.0.2.2:8000"

    debug: bool = True
    master_otp: str = "123456"

    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    # Speech-to-text model for voice entry. whisper-1 auto-detects the spoken
    # language (Hindi/Telugu/Tamil/…); swap for gpt-4o-transcribe when preferred.
    openai_transcribe_model: str = "whisper-1"

    anthropic_api_key: str = ""
    anthropic_model: str = "claude-opus-4-8"

    # --- WhatsApp Business Cloud API (server-side notification delivery) ---
    # Blank = feature disabled; the /notifications/whatsapp endpoint returns 503
    # and the app treats WhatsApp as unavailable (falls back to the in-app inbox).
    whatsapp_access_token: str = ""
    whatsapp_phone_number_id: str = ""
    whatsapp_api_version: str = "v21.0"
    # Country code prepended to bare 10-digit recipients (India by default).
    whatsapp_default_country_code: str = "91"

    cors_origins: str = "*"

    # --- Breach detection & alerting (see app/monitoring.py) ---
    # Sentry DSN → real-time email alerts for unhandled errors + security events.
    sentry_dsn: str = ""
    # Owner number for WhatsApp security alerts (SMS-like). Blank disables it.
    owner_alert_mobile: str = ""
    # Anomaly thresholds (count within window seconds → one alert per crossing).
    failed_login_window_s: int = 300
    failed_login_threshold: int = 20            # global spike (all accounts)
    failed_login_per_mobile_threshold: int = 6  # targeted brute force
    account_error_window_s: int = 300
    account_error_threshold: int = 30           # 4xx/5xx from one account
    export_window_s: int = 3600
    export_threshold: int = 15                  # data exports from one account

    # --- Request rate limiting (see app/monitoring.py + main.py middleware) ---
    # Rejects (429) callers that exceed a rolling per-window budget. Auth/OTP
    # paths get a stricter budget to blunt credential-stuffing / OTP brute force.
    # Disabled automatically when DEBUG is on (local dev, tests, staging).
    rate_limit_enabled: bool = True
    rate_limit_window_s: int = 60
    rate_limit_per_ip: int = 120        # general requests / window / IP
    rate_limit_per_user: int = 240      # general requests / window / account
    rate_limit_auth_per_ip: int = 15    # requests / window / IP on auth paths

    @model_validator(mode="after")
    def _production_secrets(self) -> "Settings":
        if not self.debug:
            if len(self.jwt_secret) < 32 or self.jwt_secret == "dev-secret-change-me":
                raise ValueError("Production requires a JWT_SECRET of at least 32 characters")
            if self.jwt_algorithm != "HS256":
                raise ValueError("This deployment supports HS256 tokens only")
            if not self.app_encryption_key:
                raise ValueError(
                    "Production requires APP_ENCRYPTION_KEY (a Fernet key) for "
                    "field-level encryption. Generate one with: python -c "
                    "\"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
                )
        return self

    @model_validator(mode="after")
    def _use_render_external_url(self) -> "Settings":
        """On Render the platform injects RENDER_EXTERNAL_URL (the public
        https://<name>.onrender.com address). Prefer it for building absolute
        attachment URLs unless PUBLIC_BASE_URL was set explicitly."""
        render_url = os.environ.get("RENDER_EXTERNAL_URL")
        if render_url and "PUBLIC_BASE_URL" not in os.environ:
            self.public_base_url = render_url
        return self


settings = Settings()
