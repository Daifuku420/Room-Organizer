from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    bootstrap_secret: str
    media_root: str = "/media"
    pairing_code_ttl_seconds: int = 600


settings = Settings()  # type: ignore[call-arg]
