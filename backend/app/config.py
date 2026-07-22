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

    public_base_url: str = "http://10.0.2.2:8000"

    debug: bool = True
    master_otp: str = "123456"

    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"

    anthropic_api_key: str = ""
    anthropic_model: str = "claude-opus-4-8"

    cors_origins: str = "*"

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
