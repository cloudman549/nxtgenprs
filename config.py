import os
import secrets

from dotenv import load_dotenv

load_dotenv()


def _env(name, default=""):
    """os.environ.get() but treats empty strings as missing (healthy defaults)."""
    value = os.environ.get(name, "").strip()
    return value if value else default


def _env_int(name, default):
    try:
        return int(os.environ.get(name, str(default)).strip() or str(default))
    except ValueError:
        return default


def _env_bool(name, default=False):
    return os.environ.get(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


def _derive_region_from_endpoint(endpoint):
    """s3.<region>.backblazeb2.com  ->  <region>"""
    if not endpoint:
        return ""
    try:
        parts = endpoint.lower().replace("https://", "").replace("http://", "").split(".")
        if parts[0].startswith("s3") and len(parts) >= 2:
            return parts[1]
    except Exception:
        pass
    return ""


class Config:
    APP_NAME = "NXTGen PRS"

    # ---- Flask / Sessions --------------------------------------------------
    SECRET_KEY = _env("SECRET_KEY") or secrets.token_hex(32)
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = _env_bool("SESSION_COOKIE_SECURE")

    # ---- MongoDB ------------------------------------------------------------
    MONGO_URI = _env("MONGO_URI", "mongodb://localhost:27017/")
    MONGO_DB_NAME = _env("MONGO_DB_NAME", "prakash_travel")

    # ---- Backblaze B2 (S3-compatible API) ------------------------------------
    B2_KEY_ID = _env("B2_KEY_ID")
    B2_APPLICATION_KEY = _env("B2_APPLICATION_KEY")
    B2_BUCKET_NAME = _env("B2_BUCKET_NAME", "my-pdf-storage-2026")
    B2_ENDPOINT = _env("B2_ENDPOINT")  # e.g. https://s3.us-west-002.backblazeb2.com
    B2_REGION = _env("B2_REGION") or _derive_region_from_endpoint(_env("B2_ENDPOINT"))

    # ---- Uploads -------------------------------------------------------------
    MAX_PDF_SIZE_MB = _env_int("MAX_PDF_SIZE_MB", 50)
    ALLOWED_EXTENSIONS = {"pdf"}
    PRESIGNED_URL_EXPIRY = _env_int("PRESIGNED_URL_EXPIRY", 900)  # seconds
    SHARE_LINK_EXPIRY = _env_int("SHARE_LINK_EXPIRY", 600)  # 10 minutes: WhatsApp share link
    PUBLIC_LIST_CACHE_SECONDS = _env_int("PUBLIC_LIST_CACHE_SECONDS", 30)
    # PDF records stay this many days, then are auto-deleted (B2 object + metadata)
    PDF_RETENTION_DAYS = _env_int("PDF_RETENTION_DAYS", 100)
    # How often the lazy expiry-purge may hit MongoDB (seconds)
    PURGE_INTERVAL_SECONDS = _env_int("PURGE_INTERVAL_SECONDS", 900)

    # ---- Optional bootstrap admin (created on first run if missing) ----------
    ADMIN_USERNAME = _env("ADMIN_USERNAME")
    ADMIN_PASSWORD = _env("ADMIN_PASSWORD")
    ADMIN_EMAIL = _env("ADMIN_EMAIL")