import io
import logging

import boto3
from botocore.client import Config as BotoConfig
from botocore.exceptions import BotoCoreError, ClientError, NoCredentialsError

from config import Config

logger = logging.getLogger(__name__)


class B2Error(Exception):
    """Raised for any Backblaze B2 operation failure."""

    def __init__(self, message, category="unknown", status_code=500):
        super().__init__(message)
        self.message = message
        self.category = category
        self.status_code = status_code


def _map_b2_error(exc, operation):
    """Convert boto3 exceptions into a clean B2Error without leaking internal details."""
    if isinstance(exc, (NoCredentialsError,)):
        return B2Error("Backblaze B2 credentials are missing or invalid.", "invalid_credentials", 502)
    if isinstance(exc, ClientError):
        error = exc.response.get("Error", {})
        code = error.get("Code", "")
        status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode", 502)
        if code in ("InvalidAccessKeyId", "SignatureDoesNotMatch", "InvalidToken"):
            return B2Error(
                "Backblaze B2 authentication failed. Check B2_KEY_ID and B2_APPLICATION_KEY.",
                "invalid_credentials", 502,
            )
        if code in ("AccessDenied",):
            return B2Error(
                "Backblaze B2 access denied. Check that the application key can read/write this bucket.",
                "access_denied", 502,
            )
        if code in ("NoSuchBucket", "404", "NotExist"):
            return B2Error(
                f"B2 bucket not found or not accessible: {Config.B2_BUCKET_NAME}",
                "bucket_not_found", 502,
            )
        if code == "NoSuchKey":
            return B2Error("The requested PDF does not exist in storage.", "not_found", 404)
        if code == "EntityTooLarge":
            return B2Error("The file is too large for storage.", "too_large", 502)
        return B2Error(f"Storage error during '{operation}'.", "b2_error", status or 502)
    if isinstance(exc, BotoCoreError):
        return B2Error(
            "Could not reach the Backblaze B2 endpoint. Check B2_ENDPOINT and your network.",
            "connection_failed", 502,
        )
    return B2Error(f"Unexpected storage error during '{operation}'.", "b2_error", 500)


class B2Client:
    """Thin, safe wrapper around the Backblaze B2 S3-compatible API."""

    def __init__(self):
        self.key_id = Config.B2_KEY_ID
        self.application_key = Config.B2_APPLICATION_KEY
        self.bucket_name = Config.B2_BUCKET_NAME
        self.endpoint = Config.B2_ENDPOINT
        self.region = Config.B2_REGION
        self._client = None

    def is_configured(self):
        return bool(self.key_id and self.application_key and self.endpoint and self.bucket_name)

    @property
    def s3(self):
        if not self.is_configured():
            raise B2Error(
                "Backblaze B2 is not configured. Set B2_KEY_ID, B2_APPLICATION_KEY, "
                "B2_BUCKET_NAME and B2_ENDPOINT in the .env file.",
                "not_configured", 502,
            )
        if not self.region:
            raise B2Error(
                "B2_ENDPOINT looks invalid. It must look like "
                "https://s3.us-west-002.backblazeb2.com (find it in the Backblaze dashboard).",
                "not_configured", 502,
            )
        if self._client is None:
            self._client = boto3.client(
                "s3",
                aws_access_key_id=self.key_id,
                aws_secret_access_key=self.application_key,
                endpoint_url=self.endpoint,
                region_name=self.region,
                config=BotoConfig(
                    signature_version="s3v4",
                    s3={"addressing_style": "path"},
                    connect_timeout=15,
                    read_timeout=120,
                ),
            )
        return self._client

    def ping(self):
        """Verify connection + credentials + bucket access by listing up to 1 object."""
        try:
            self.s3.list_objects_v2(Bucket=self.bucket_name, MaxKeys=1)
            return True
        except Exception as exc:
            raise _map_b2_error(exc, "list bucket")

    def upload_pdf(self, file_obj, key, content_type="application/pdf"):
        """Stream the PDF bytes into B2. Never loads the whole file into memory."""
        try:
            self.s3.upload_fileobj(file_obj, self.bucket_name, key, ExtraArgs={"ContentType": content_type})
        except Exception as exc:
            raise _map_b2_error(exc, "upload")
        return key

    def upload_bytes(self, data, key, content_type="application/octet-stream"):
        """Upload raw bytes (chat images etc.) into B2."""
        try:
            self.s3.upload_fileobj(io.BytesIO(data), self.bucket_name, key, ExtraArgs={"ContentType": content_type})
        except Exception as exc:
            raise _map_b2_error(exc, "upload")
        return key

    def delete_object(self, key):
        """Delete an object. Returns True if removed, False if it did not exist."""
        try:
            self.s3.delete_object(Bucket=self.bucket_name, Key=key)
            return True
        except Exception as exc:
            err = _map_b2_error(exc, "delete")
            if err.category == "not_found":
                logger.warning("Tried to delete %s but it did not exist in B2.", key)
                return False
            raise err

    def generate_presigned_get_url(self, key, filename=None, expires_in=900):
        """Short-lived private GET URL (default 15 minutes)."""
        params = {"Bucket": self.bucket_name, "Key": key}
        if filename:
            safe = filename.replace('"', "").encode("ascii", "ignore").decode("ascii") or "download.pdf"
            params["ResponseContentDisposition"] = f'attachment; filename="{safe}"'
            params["ResponseContentType"] = "application/pdf"
        try:
            return self.s3.generate_presigned_url(
                "get_object",
                Params=params,
                ExpiresIn=expires_in,
            )
        except Exception as exc:
            raise _map_b2_error(exc, "generate download link")

    def object_exists(self, key):
        try:
            self.s3.head_object(Bucket=self.bucket_name, Key=key)
            return True
        except Exception as exc:
            err = _map_b2_error(exc, "check object")
            if err.category == "not_found":
                return False
            raise err

    def get_object_bytes(self, key):
        """Download a B2 object's bytes (small-to-medium PDFs ka liye)."""
        try:
            resp = self.s3.get_object(Bucket=self.bucket_name, Key=key)
            try:
                return resp["Body"].read()
            finally:
                try:
                    resp["Body"].close()
                except Exception:
                    pass
        except Exception as exc:
            raise _map_b2_error(exc, "download")


def make_test_pdf_bytes(name="Test PDF"):
    """A tiny, valid-enough PDF used only by the test scripts."""
    return (
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n"
        b"trailer<</Root 1 0 R>>\n"
        b"%%EOF\n"
    )