import http.cookiejar
import io
import json
import re

import logging
import os
import secrets
import time
import urllib.parse
import urllib.request
import uuid
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from functools import wraps

import click
from bson import ObjectId
from bson.errors import InvalidId
from flask import (Flask, abort, g, jsonify, redirect, render_template, request,
                   send_file, send_from_directory, session, url_for)
from pymongo import ASCENDING, MongoClient
from pymongo.errors import DuplicateKeyError, PyMongoError
from werkzeug.exceptions import RequestEntityTooLarge
from werkzeug.security import check_password_hash, generate_password_hash

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as _canvas
from reportlab.platypus import (BaseDocTemplate, Frame, FrameBreak, KeepTogether,
                                PageBreak, PageTemplate, Paragraph, SimpleDocTemplate,
                                Spacer, Table, TableStyle)
from reportlab.platypus.flowables import KeepInFrame

# --- PDF fonts (prettier TTF with safe fallback) ---
_FONT_NORMAL = "Helvetica"
_FONT_BOLD = "Helvetica-Bold"
_FONT_ITALIC = "Helvetica-Oblique"
_FONT_BOLD_ITALIC = "Helvetica-BoldOblique"
try:
    from reportlab.pdfbase import pdfmetrics as _pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont as _TTFont

    _fonts_dir = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")
    _family = None
    for _fam, _n, _b, _i, _bi in (
        ("Verdana", "VERDANA.TTF", "VERDANAB.TTF", "VERDANAI.TTF", "VERDANAZ.TTF"),
        ("Segoe UI", "segoeui.ttf", "segoeuib.ttf", "segoeuii.ttf", "segoeuiz.ttf"),
    ):
        try:
            _pdfmetrics.registerFont(_TTFont(_fam, os.path.join(_fonts_dir, _n)))
            _pdfmetrics.registerFont(_TTFont(_fam + "-Bold", os.path.join(_fonts_dir, _b)))
            _pdfmetrics.registerFont(_TTFont(_fam + "-Italic", os.path.join(_fonts_dir, _i)))
            _pdfmetrics.registerFont(_TTFont(_fam + "-BoldItalic", os.path.join(_fonts_dir, _bi)))
            _pdfmetrics.registerFontFamily(_fam, normal=_fam, bold=_fam + "-Bold",
                                           italic=_fam + "-Italic", boldItalic=_fam + "-BoldItalic")
            _family = _fam
            break
        except Exception:
            _family = None
    if _family:
        _FONT_NORMAL = _family
        _FONT_BOLD = _family + "-Bold"
        _FONT_ITALIC = _family + "-Italic"
        _FONT_BOLD_ITALIC = _family + "-BoldItalic"
except Exception:
    pass

from b2_client import B2Client, B2Error
from config import Config

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

if Config.MONGO_URI and Config.MONGO_URI.startswith("mongodb"):
    logger.info("Using MongoDB URI: %s", Config.MONGO_URI.split("@")[-1] or Config.MONGO_URI)
else:
    logger.warning("MONGO_URI missing or invalid in .env")

# ---------------------------------------------------------------- Flask app
app = Flask(__name__)
app.config["SECRET_KEY"] = Config.SECRET_KEY
app.config["MAX_CONTENT_LENGTH"] = Config.MAX_PDF_SIZE_MB * 1024 * 1024
app.config["SESSION_COOKIE_HTTPONLY"] = Config.SESSION_COOKIE_HTTPONLY
app.config["SESSION_COOKIE_SAMESITE"] = Config.SESSION_COOKIE_SAMESITE
app.config["SESSION_COOKIE_SECURE"] = Config.SESSION_COOKIE_SECURE

if Config.SECRET_KEY.startswith("dev-only"):
    logger.warning("SECRET_KEY is using the dev fallback. Set a real value in .env before deploying.")

# ---------------------------------------------------------------- MongoDB
mongo_client = MongoClient(
    Config.MONGO_URI,
    serverSelectionTimeoutMS=5000,
    connectTimeoutMS=8000,
    socketTimeoutMS=60000,
    maxPoolSize=20,
    minPoolSize=1,
    retryWrites=True,
    appName="nxtgenprs",
)
# Prime the pool so the first real request is not cold (Atlas TLS handshake).
def _prime_mongo():
    try:
        mongo_client.admin.command("ping")
        list(users_col.find({}, {"_id": 1}).limit(1))
    except Exception:
        logger.debug("Mongo not reachable yet; will retry on next request.")
db = mongo_client[Config.MONGO_DB_NAME]
users_col = db["users"]
pdfs_col = db["pdfs"]
tickets_col = db["tickets"]

fresh_ids_col = db["fresh_ids"]

notepad_col = db["notepad"]

chat_col = db["chat_messages"]

call_members_col = db["call_members"]
call_signals_col = db["call_signals"]

_CALL_ROOM = "group"
_CALL_TIMEOUT_SECONDS = 40

def _init_db():
    try:
        users_col.create_index([("username", ASCENDING)], unique=True)
    except PyMongoError as exc:
        logger.warning("Index 'username' not created: %s", exc)
    try:
        # NOTE: email uniqueness koi extra constraint nahi partha (code-level check karta hai).
        # Unique(email) + blank email = sab create fail ho jate the. Isliye non-unique.
        users_col.create_index([("email", ASCENDING)], unique=False)
    except PyMongoError as exc:
        logger.warning("Index 'email' not created: %s", exc)
    try:
        pdfs_col.create_index([("b2_key", ASCENDING)], unique=True)
    except PyMongoError as exc:
        logger.warning("Index 'b2_key' not created: %s", exc)
    # PDF expiry: after PDF_RETENTION_DAYS the MongoDB doc auto-deletes itself.
    try:
        pdfs_col.create_index([("expires_at", ASCENDING)], expireAfterSeconds=0)
    except PyMongoError as exc:
        logger.warning("Index 'expires_at' not created: %s", exc)
    try:
        pdfs_col.create_index([("uploaded_at", ASCENDING)], unique=False)
    except PyMongoError as exc:
        logger.warning("Index 'uploaded_at' not created: %s", exc)
    try:
        tickets_col.create_index([("user_id", ASCENDING)], unique=False)
    except PyMongoError as exc:
        logger.warning("Index 'tickets.user_id' not created: %s", exc)
    try:
        fresh_ids_col.create_index([("user_id", ASCENDING)], unique=False)
    except PyMongoError as exc:
        logger.warning("Index 'fresh_ids.user_id' not created: %s", exc)


_init_db()


def _backfill_expires_at():
    """Purane PDFs (bina expires_at) ko bhi 100-din rule me lao."""
    try:
        missing = pdfs_col.find({"expires_at": {"$exists": False}}, {"uploaded_at": 1})
        count = 0
        for doc in missing:
            base = doc.get("uploaded_at") or datetime.now(timezone.utc)
            pdfs_col.update_one(
                {"_id": doc["_id"]},
                {"$set": {"expires_at": base + timedelta(days=Config.PDF_RETENTION_DAYS)}},
            )
            count += 1
        if count:
            logger.info("Backfilled expires_at for %d old PDFs", count)
    except PyMongoError:
        logger.exception("Backfill expires_at failed")


_backfill_expires_at()

# ---------------------------------------------------------------- Backblaze B2
b2 = B2Client()

if not b2.is_configured():
    logger.warning(
        "Backblaze B2 is NOT fully configured. Upload/download/delete will fail until "
        "B2_KEY_ID, B2_APPLICATION_KEY, B2_ENDPOINT are set in .env."
    )

# ---------------------------------------------------------------- Bootstrap admin
def _bootstrap_admin():
    if not (Config.ADMIN_USERNAME and Config.ADMIN_PASSWORD):
        return
    if users_col.find_one({"username": Config.ADMIN_USERNAME}):
        return
    users_col.insert_one(
        {
            "username": Config.ADMIN_USERNAME,
            "email": Config.ADMIN_EMAIL or f"{Config.ADMIN_USERNAME}@prakashtravel.local",
            "password_hash": generate_password_hash(Config.ADMIN_PASSWORD),
            "role": "admin",
            "created_at": datetime.now(timezone.utc),
        }
    )
    logger.info("Bootstrap admin created: %s", Config.ADMIN_USERNAME)


try:
    _bootstrap_admin()
except PyMongoError:
    logger.exception("Could not bootstrap admin user (is MongoDB reachable?)")

# ---------------------------------------------------------------- Helpers
_CACHE = {}
_CACHE_MAX_AGE = Config.PUBLIC_LIST_CACHE_SECONDS
PUBLIC_LIST_CACHE_KEY = "public_pdfs_list"


def _cache_get(key):
    entry = _CACHE.get(key)
    if entry and entry[0] + _CACHE_MAX_AGE >= time.time():
        return entry[1]
    return None


def _cache_set(key, value):
    _CACHE[key] = (time.time(), value)


def _cache_invalidate(key):
    _CACHE.pop(key, None)


_USER_CACHE = {}
_USER_CACHE_TTL = 8  # seconds: harek request ke liye Atlas round-trip bachata hai
_USER_CACHE_TOKEN = 0


def _bump_user_cache():
    global _USER_CACHE_TOKEN
    _USER_CACHE_TOKEN += 1
    _USER_CACHE.clear()


def get_current_user():
    """Cached per-request user lookup so the DB is hit only once per request."""
    if not hasattr(g, "_current_user"):
        uid = session.get("user_id")
        if not uid:
            g._current_user = None
        else:
            cached = None
            try:
                cached = _USER_CACHE.get((uid, _USER_CACHE_TOKEN))
            except Exception:
                cached = None
            if cached and cached[0] + _USER_CACHE_TTL >= time.time():
                g._current_user = cached[1]
            else:
                try:
                    g._current_user = users_col.find_one({"_id": ObjectId(uid)}, {"password_hash": 0})
                except (InvalidId, PyMongoError):
                    g._current_user = None
                try:
                    _USER_CACHE[(uid, _USER_CACHE_TOKEN)] = (time.time(), g._current_user)
                except Exception:
                    pass
    return g._current_user


def _is_api_request():
    path = request.path.rstrip("/") or "/"
    return path.startswith("/admin/api") or path.startswith("/api/") or path == "/api"


@app.context_processor
def inject_user():
    user = get_current_user()
    return {"current_user": user, "is_admin": bool(user and user.get("role") == "admin")}


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        user = get_current_user()
        if user is None:
            if _is_api_request():
                return jsonify({"success": False, "error": "Authentication required. Please log in again."}), 401
            return redirect(url_for("login", next=request.full_path))
        return view(user, *args, **kwargs)

    return wrapped


def admin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        user = get_current_user()
        if user is None:
            if _is_api_request():
                return jsonify({"success": False, "error": "Authentication required. Please log in again."}), 401
            return redirect(url_for("login", next=request.full_path))
        if user.get("role") != "admin":
            if _is_api_request():
                return jsonify({"success": False, "error": "Admin access required."}), 403
            abort(403)
        return view(user, *args, **kwargs)

    return wrapped


# ---------------------------------------------------------------- CSRF (lightweight)
def set_csrf_token():
    token = session.get("csrf_token")
    if not token:
        token = secrets.token_hex(32)
        session["csrf_token"] = token
    return token


def validate_csrf():
    supplied = request.headers.get("X-CSRF-Token") or request.form.get("csrf_token")
    stored = session.get("csrf_token", "")
    return bool(supplied and stored and secrets.compare_digest(supplied, stored))


def csrf_protected(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            if not validate_csrf():
                return jsonify({"success": False, "error": "CSRF token missing or invalid. Refresh the page and try again."}), 400
        return view(*args, **kwargs)

    return wrapped


app.jinja_env.globals["csrf_token"] = set_csrf_token


@app.route("/static/<path:filename>")
def _serve_static(filename):
    """Vercel serverless me static files Flask se serve karo (config se independent)."""
    try:
        return send_from_directory(app.static_folder, filename)
    except Exception:
        abort(404)


@app.after_request
def _perf_headers(resp):
    if request.path.startswith("/static/"):
        # Cache-busting ?v= already in URLs; static files never change under a v.
        resp.headers["Cache-Control"] = "public, max-age=604800, immutable"
    return resp

# ---------------------------------------------------------------- PDF helpers
def _human_size(num):
    num = float(num or 0)
    for unit in ("B", "KB", "MB", "GB"):
        if num < 1024.0:
            return f"{num:.0f} {unit}" if unit == "B" else f"{num:.1f} {unit}"
        num /= 1024.0
    return f"{num:.1f} TB"


def _sanitize_filename(name):
    base = os.path.basename(name or "").replace("\\", "/").split("/")[-1]
    base = "".join(ch for ch in base if ch not in '\x00\r\n\t"').strip()
    base = base[:200]
    if not base:
        base = "document.pdf"
    if not base.lower().endswith(".pdf"):
        base = base + ".pdf"
    return base


def _max_bytes():
    return Config.MAX_PDF_SIZE_MB * 1024 * 1024


def _get_validated_pdf():
    """Validate presence, emptiness, size and PDF magic bytes. Returns (file, filename, size)."""
    if "file" not in request.files:
        raise ValueError("No file part in the request.")
    f = request.files["file"]
    if not f or not f.filename:
        raise ValueError("No file selected. Choose a PDF file first.")
    original = _sanitize_filename(f.filename)

    file_bytes = f.read(5)
    f.seek(0)
    if file_bytes[:5] != b"%PDF-":
        raise ValueError("The file is not a valid PDF. Only PDF files can be uploaded.")

    f.seek(0, os.SEEK_END)
    size = f.tell()
    f.seek(0)
    if size == 0:
        raise ValueError("The file is empty.")

    limit = _max_bytes()
    if size > limit:
        raise ValueError(f"The file is too large. Maximum allowed size is {Config.MAX_PDF_SIZE_MB} MB.")

    return f, original, size


def _new_object_key():
    return f"pdfs/{uuid.uuid4().hex}.pdf"


def _find_pdf(pdf_id):
    try:
        oid = ObjectId(pdf_id)
    except (InvalidId, TypeError):
        return None
    try:
        return pdfs_col.find_one({"_id": oid})
    except PyMongoError:
        logger.exception("MongoDB lookup failed")
        return None


def _serialize_pdf(doc, with_uploader=False, uploader_names=None):
    data = {
        "id": str(doc["_id"]),
        "filename": doc.get("filename", "document.pdf"),
        "size": doc.get("size", 0),
        "size_human": _human_size(doc.get("size", 0)),
        "content_type": doc.get("content_type", "application/pdf"),
        "uploaded_at": doc.get("uploaded_at").isoformat() if doc.get("uploaded_at") else None,
        "expires_at": doc.get("expires_at").isoformat() if doc.get("expires_at") else None,
        "access_user": doc.get("access_user"),
        "access_pass": doc.get("access_pass"),
    }
    uploaded_by = doc.get("uploaded_by")
    if uploaded_by:
        data["uploaded_by"] = str(uploaded_by)
        if with_uploader:
            data["uploaded_by_username"] = (uploader_names or {}).get(str(uploaded_by)) or "Unknown"
    else:
        data["uploaded_by"] = None
        if with_uploader:
            data["uploaded_by_username"] = "Public"
    return data


def _collect_uploader_names(docs):
    """One $in query for all uploaders instead of N individual lookups (fast)."""
    ids = {d.get("uploaded_by") for d in docs if d.get("uploaded_by")}
    if not ids:
        return {}
    names = {}
    for u in users_col.find({"_id": {"$in": list(ids)}}, {"username": 1}):
        names[str(u["_id"])] = u.get("username", "Unknown")
    return names


# ---------------------------------------------------------------- Auto-expiry (100 days)
_LAST_PURGE = {"ts": 0.0}


def _expires_at():
    """PD modal: upload date + 100 days (PDF_RETENTION_DAYS)."""
    return datetime.now(timezone.utc) + timedelta(days=Config.PDF_RETENTION_DAYS)


def _purge_expired():
    """Delete PDFs whose 100-day window is over.
    Video: B2 object pehle delete, metadata baad -> consistent.
    Throttled so it runs at most every PURGE_INTERVAL_SECONDS."""

    now_ts = time.time()
    if now_ts - _LAST_PURGE["ts"] < Config.PURGE_INTERVAL_SECONDS:
        return
    _LAST_PURGE["ts"] = now_ts

    try:
        expired = list(
            pdfs_col.find({"expires_at": {"$lte": datetime.now(timezone.utc)}})
        )
    except PyMongoError:
        logger.exception("Expiry purge: DB scan failed")
        return

    for doc in expired:
        key = doc.get("b2_key")
        if key:
            try:
                b2.delete_object(key)
            except B2Error as exc:
                logger.warning("Expiry purge: could not delete B2 object %s: %s", key, exc)
        try:
            pdfs_col.delete_one({"_id": doc["_id"]})
            logger.info("Auto-deleted expired PDF %s", doc.get("filename"))
        except PyMongoError:
            logger.exception("Expiry purge: could not delete metadata for %s", doc.get("_id"))

    if expired:
        _cache_invalidate(PUBLIC_LIST_CACHE_KEY)


def _json_error(message, status):
    return jsonify({"success": False, "error": message}), status


# ---------------------------------------------------------------- Routes: pages
@app.route("/")
@app.route("/upload")
def index():
    """Public page render. Upload aur list/download dono ab login mangte hain."""
    return render_template(
        "home.html",
        max_size_mb=Config.MAX_PDF_SIZE_MB,
        retention_days=Config.PDF_RETENTION_DAYS,
        presign_expiry_minutes=max(1, Config.PRESIGNED_URL_EXPIRY // 60),
    )


@app.route("/login", methods=["GET", "POST"])
def login():
    if get_current_user():
        return redirect(url_for("index"))

    error = None
    if request.method == "POST":
        if not validate_csrf():
            error = "CSRF token invalid. Reload the page and try again."
        else:
            identifier = (request.form.get("username") or "").strip()
            password = request.form.get("password") or ""
            user = users_col.find_one({"username": identifier}) or users_col.find_one({"email": identifier.lower()})
            if user and user.get("role") == "admin":
                error = "Ye admin account hai. Admin Login use karein."
            elif user and not user.get("password_hash"):
                # purane accounts (jab password nahi tha) abhi bhi chalte rahein
                session.clear()
                _bump_user_cache()
                session["user_id"] = str(user["_id"])
                set_csrf_token()
                next_url = request.args.get("next") or url_for("index")
                if not next_url.startswith("/"):
                    next_url = url_for("index")
                return redirect(next_url)
            elif user and check_password_hash(user.get("password_hash", ""), password):
                session.clear()
                _bump_user_cache()
                session["user_id"] = str(user["_id"])
                set_csrf_token()
                next_url = request.args.get("next") or url_for("index")
                if not next_url.startswith("/"):
                    next_url = url_for("index")
                return redirect(next_url)
            elif user:
                error = "Password galat hai."
            else:
                error = "User ID galat hai."

    return render_template("login.html", error=error)


@app.route("/admin-login", methods=["GET", "POST"])
def admin_login():
    """Sirf admin accounts login kar sakte hain isse."""
    user = get_current_user()
    if user and user.get("role") == "admin":
        return redirect(url_for("admin_panel"))

    error = None
    if request.method == "POST":
        if not validate_csrf():
            error = "CSRF token invalid. Reload the page and try again."
        else:
            identifier = (request.form.get("username") or "").strip()
            password = request.form.get("password") or ""
            user = users_col.find_one({"username": identifier}) or users_col.find_one({"email": identifier.lower()})
            if user and check_password_hash(user.get("password_hash", ""), password):
                if user.get("role") != "admin":
                    error = "Ye normal user account hai. Normal login use karein."
                else:
                    session.clear()
                    _bump_user_cache()
                    session["user_id"] = str(user["_id"])
                    set_csrf_token()
                    return redirect(url_for("admin_panel"))
            else:
                error = "Username/email ya password galat hai."

    return render_template("admin_login.html", error=error)


@app.route("/signup", methods=["GET", "POST"])
@admin_required
def signup(user):
    """Account creation sirf admin kar sakta hai (form admin panel se bhi aata hai)."""
    if request.method == "POST":
        if not validate_csrf():
            error = "CSRF token invalid. Reload the page and try again."
        else:
            username = (request.form.get("username") or "").strip()
            email = (request.form.get("email") or "").strip().lower()
            password = request.form.get("password") or ""
            role = (request.form.get("role") or "user").strip()

            import re

            if not re.match(r"^[\w.\-]{3,30}$", username):
                error = "Username must be 3-30 characters (letters, numbers, dot, dash, underscore)."
            elif "@" not in email or "." not in email.split("@")[-1]:
                error = "Please enter a valid email address."
            elif len(password) < 8:
                error = "Password must be at least 8 characters long."
            elif role not in ("user", "admin"):
                error = "Invalid role."
            else:
                try:
                    users_col.insert_one(
                        {
                            "username": username,
                            "email": email,
                            "password_hash": generate_password_hash(password),
                            "role": role,
                            "created_at": datetime.now(timezone.utc),
                        }
                    )
                except DuplicateKeyError:
                    error = "Username or email is already registered."
                else:
                    if request.headers.get("Accept") == "application/json" or request.content_type == "application/json":
                        return jsonify({"success": True, "message": "Account created."}), 201
                    return redirect(url_for("admin_panel"))

    return render_template("signup.html", error=error if "error" in locals() else None)


@app.route("/logout", methods=["POST"])
@csrf_protected
def logout():
    session.clear()
    _bump_user_cache()
    return redirect(url_for("index"))


@app.route("/admin")
@admin_required
def admin_panel(user):
    return render_template(
        "admin_pdfs.html",
        user=user,
        max_size_mb=Config.MAX_PDF_SIZE_MB,
        presign_expiry_minutes=max(1, Config.PRESIGNED_URL_EXPIRY // 60),
    )


# ---------------------------------------------------------------- Routes: PDF APIs (public)
@app.route("/api/pdfs", methods=["GET"])
@login_required
def api_list_pdfs_public(user):
    """List requires login (bina login list nahi dikhti). In-memory cached for speed."""
    _purge_expired()
    cached = _cache_get(PUBLIC_LIST_CACHE_KEY)
    if cached is None:
        try:
            docs = list(
                pdfs_col.find({}, {"filename": 1, "size": 1, "content_type": 1, "uploaded_at": 1, "expires_at": 1, "access_user": 1, "access_pass": 1})
                    .sort("uploaded_at", -1)
                    .limit(200)
            )
            payload = {"success": True, "pdfs": [_serialize_pdf(d) for d in docs]}
            _cache_set(PUBLIC_LIST_CACHE_KEY, payload)
            cached = payload
        except PyMongoError:
            logger.exception("Failed to list PDFs")
            return _json_error("Could not read the database. Is MongoDB running?", 500)
    resp = jsonify(cached)
    resp.headers["Cache-Control"] = "private, max-age=60"
    return resp


@app.route("/api/upload", methods=["POST"])
@login_required
@csrf_protected
def api_upload_public(user):
    """Upload requires login (admin ho ya employee) — taaki pata rahe ye kaam kisne kiya.
    Still CSRF-protected to stop abuse."""
    if not b2.is_configured():
        return _json_error("Storage is not configured on the server. Contact the admin.", 502)

    user = get_current_user()
    try:
        stream, original, size = _get_validated_pdf()
    except ValueError as exc:
        return _json_error(str(exc), 400)

    access_user = (request.form.get("access_user") or "").strip()
    access_pass = request.form.get("access_pass") or ""

    key = _new_object_key()
    try:
        b2.upload_pdf(stream, key)
    except B2Error as exc:
        logger.error("B2 upload failed: %s", exc)
        return _json_error(exc.message, exc.status_code)

    doc = {
        "filename": original,
        "b2_key": key,
        "size": size,
        "content_type": "application/pdf",
        "uploaded_at": datetime.now(timezone.utc),
        "expires_at": _expires_at(),
        "uploaded_by": user["_id"],
        "uploader": (user.get("emp") or {}).get("full_name") or user.get("username", ""),
    }
    if access_user:
        doc["access_user"] = access_user
    if access_pass:
        doc["access_pass"] = access_pass
    try:
        result = pdfs_col.insert_one(doc)
    except PyMongoError:
        logger.exception("MongoDB insert failed; cleaning up B2 object %s", key)
        try:
            b2.delete_object(key)
        except B2Error:
            logger.exception("Could not clean up orphan B2 object %s", key)
        return _json_error("File was uploaded to storage but metadata could not be saved. Please retry.", 500)

    _cache_invalidate(PUBLIC_LIST_CACHE_KEY)
    doc["_id"] = result.inserted_id
    return jsonify({"success": True, "pdf": _serialize_pdf(doc)}), 201


@app.route("/admin/api/pdfs", methods=["GET"])
@admin_required
def api_list_pdfs_admin(user):
    """Admin-only full list with uploader names."""
    _purge_expired()
    try:
        docs = list(pdfs_col.find().sort("uploaded_at", -1))
        names = _collect_uploader_names(docs)
        items = [_serialize_pdf(d, with_uploader=True, uploader_names=names) for d in docs]
    except PyMongoError:
        logger.exception("Failed to list PDFs")
        return _json_error("Could not read the database. Is MongoDB running?", 500)
    return jsonify({"success": True, "pdfs": items})


@app.route("/admin/api/pdfs/<pdf_id>/replace", methods=["POST"])
@admin_required
@csrf_protected
def api_replace_pdf(user, pdf_id):
    doc = _find_pdf(pdf_id)
    if doc is None:
        return _json_error("PDF not found in the database.", 404)

    try:
        stream, original, size = _get_validated_pdf()
    except ValueError as exc:
        return _json_error(str(exc), 400)

    old_key = doc.get("b2_key")
    new_key = _new_object_key()

    # 1) Upload the NEW pdf first. The old file stays untouched if this fails.
    try:
        b2.upload_pdf(stream, new_key)
    except B2Error as exc:
        logger.error("Replace upload failed for %s: %s", pdf_id, exc)
        return _json_error(f"Uploading the new PDF failed. The old file was kept. {exc.message}", exc.status_code)

    # 2) Update metadata only after a successful upload.
    try:
        pdfs_col.update_one(
            {"_id": doc["_id"]},
            {"$set": {
                "filename": original,
                "b2_key": new_key,
                "size": size,
                "content_type": "application/pdf",
                "uploaded_at": datetime.now(timezone.utc),
                "expires_at": _expires_at(),
                "uploaded_by": user["_id"],
            }},
        )
    except PyMongoError:
        logger.exception("Replace metadata update failed; rolling back new object %s", new_key)
        try:
            b2.delete_object(new_key)
        except B2Error:
            logger.exception("Could not roll back new B2 object %s", new_key)
        return _json_error("Metadata update failed. The old file was kept.", 500)

    # 3) Best-effort cleanup of the old object. Never breaks the new file.
    if old_key and old_key != new_key:
        try:
            b2.delete_object(old_key)
            logger.info("Removed old B2 object %s after replace", old_key)
        except B2Error as exc:
            logger.warning("Could not remove old B2 object %s after replace: %s", old_key, exc)

    _cache_invalidate(PUBLIC_LIST_CACHE_KEY)
    updated = _find_pdf(pdf_id)
    return jsonify({"success": True, "pdf": _serialize_pdf(updated, with_uploader=True)})


def _b2_download_response(doc, as_attachment=True):
    """B2 se bytes le kar PDF stream karta hai — URL apne domain pe rehta hai, suspicious backblaze link nahi."""
    try:
        data = b2.get_object_bytes(doc["b2_key"])
    except B2Error as exc:
        logger.error("Could not fetch %s from B2: %s", doc["b2_key"], exc)
        return _json_error(exc.message, exc.status_code)
    fname = (doc.get("filename") or "download.pdf").replace('"', "")
    safe = fname.encode("ascii", "ignore").decode("ascii").strip() or "download.pdf"
    return send_file(io.BytesIO(data), mimetype="application/pdf",
                     download_name=safe, as_attachment=as_attachment, max_age=0)


@app.route("/api/pdfs/<pdf_id>/share", methods=["GET"])
@login_required
def api_share_pdf(user, pdf_id):
    """Chota share link banata hai (10 min valid) jo isi app ke domain ka hota hai."""
    doc = _find_pdf(pdf_id)
    if doc is None:
        return _json_error("PDF not found in the database.", 404)
    now = datetime.now(timezone.utc)
    exp = now + timedelta(seconds=Config.SHARE_LINK_EXPIRY)
    token = doc.get("share_token") or secrets.token_urlsafe(4)
    pdfs_col.update_one(
        {"_id": doc["_id"]},
        {"$set": {"share_token": token, "share_exp": exp}},
    )
    url = f"{request.host_url.rstrip('/')}/s/{token}"
    return jsonify({
        "success": True,
        "url": url,
        "expires_in": Config.SHARE_LINK_EXPIRY,
        "filename": doc.get("filename"),
    })


@app.route("/s/<token>", methods=["GET"])
def api_share_stream(token):
    """Share link hit karne pe direct PDF milti hai — login ki zaroorat nahi (token 10 min valid)."""
    doc = pdfs_col.find_one({"share_token": (token or "").strip()})
    if doc is None:
        return _json_error("Link invalid hai ya toot gaya.", 404)
    exp = doc.get("share_exp")
    if exp is not None and exp.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        return _json_error("Share link expire ho gaya hai. Dobara share karo.", 410)
    return _b2_download_response(doc)


@app.route("/api/pdfs/<pdf_id>/view", methods=["GET"])
@login_required
def api_view_pdf(user, pdf_id):
    """PDF browser me direct inline kholta hai — download nahi hoti (koi save nahi dikhta)."""
    doc = _find_pdf(pdf_id)
    if doc is None:
        return _json_error("PDF not found in the database.", 404)
    return _b2_download_response(doc, as_attachment=False)


@app.route("/api/pdfs/<pdf_id>/download", methods=["GET"])
@login_required
def api_download_pdf(user, pdf_id):
    """Login ke baad direct download — isi app ke through stream hota hai (apna domain)."""
    doc = _find_pdf(pdf_id)
    if doc is None:
        return _json_error("PDF not found in the database.", 404)
    return _b2_download_response(doc)


@app.route("/api/pdfs/<pdf_id>", methods=["DELETE"])
@login_required
@csrf_protected
def api_delete_pdf_owner(user, pdf_id):
    """Logged-in user apni PDF delete kar sakta hai; admin kisi bhi ki."""
    doc = _find_pdf(pdf_id)
    if doc is None:
        return _json_error("PDF not found in the database.", 404)

    is_admin = user.get("role") == "admin"
    is_owner = bool(doc.get("uploaded_by")) and str(doc.get("uploaded_by")) == str(user["_id"])
    if not (is_admin or is_owner):
        return _json_error("Sirf admin ya is PDF ka uploader hi ise delete kar sakta hai.", 403)

    key = doc.get("b2_key")
    try:
        b2.delete_object(key)
    except B2Error as exc:
        logger.error("B2 delete failed for %s: %s", pdf_id, exc)
        return _json_error(exc.message, exc.status_code)

    try:
        pdfs_col.delete_one({"_id": doc["_id"]})
    except PyMongoError:
        logger.exception("MongoDB delete failed for %s", pdf_id)
        return _json_error("File removed from storage but metadata could not be removed. Contact the admin.", 500)

    _cache_invalidate(PUBLIC_LIST_CACHE_KEY)
    return jsonify({"success": True, "message": "PDF deleted successfully."})


@app.route("/admin/api/pdfs/<pdf_id>", methods=["DELETE"])
@admin_required
@csrf_protected
def api_delete_pdf(user, pdf_id):
    doc = _find_pdf(pdf_id)
    if doc is None:
        return _json_error("PDF not found in the database.", 404)

    key = doc.get("b2_key")
    try:
        removed = b2.delete_object(key)
    except B2Error as exc:
        logger.error("B2 delete failed for %s: %s", pdf_id, exc)
        return _json_error(exc.message, exc.status_code)

    try:
        pdfs_col.delete_one({"_id": doc["_id"]})
    except PyMongoError:
        logger.exception("MongoDB delete failed for %s", pdf_id)
        return _json_error("File removed from storage but metadata could not be removed. Contact the admin.", 500)

    _cache_invalidate(PUBLIC_LIST_CACHE_KEY)
    return jsonify({"success": True, "message": "PDF deleted successfully.", "removed_in_b2": removed})


@app.route("/admin/api/users", methods=["GET"])
@admin_required
def api_list_users(user):
    """Admin-only: sabhi accounts ki list."""
    try:
        docs = list(users_col.find().sort("created_at", -1))
        items = [
            {
                "_id": str(d["_id"]),
                "username": d.get("username"),
                "email": d.get("email"),
                "role": d.get("role", "user"),
                "created_at": d.get("created_at"),
            }
            for d in docs
        ]
    except PyMongoError:
        logger.exception("Failed to list users")
        return _json_error("Could not read the database.", 500)
    return jsonify({"success": True, "users": items})


@app.route("/admin/api/users", methods=["POST"])
@admin_required
@csrf_protected
def api_create_user(user):
    """Admin hi account bana sakta hai. Normal login se account nahi banta.
    Sirf User ID (username) zaroori hai; email/password optional."""
    import re

    username = (request.form.get("username") or "").strip()
    email = (request.form.get("email") or "").strip().lower()
    password = request.form.get("password") or ""

    if not re.match(r"^[\w.\-]{3,30}$", username):
        return _json_error("User ID 3-30 characters (letters, numbers, dot, dash, underscore).", 400)
    if email and ("@" not in email or "." not in email.split("@")[-1]):
        return _json_error("Please enter a valid email address.", 400)

    if users_col.find_one({"username": username}):
        return _json_error("Ye User ID pehle se registered hai.", 409)
    if email and users_col.find_one({"email": email}):
        return _json_error("Ye email pehle se registered hai.", 409)

    try:
        result = users_col.insert_one(
            {
                "username": username,
                "email": email or None,
                "password_hash": generate_password_hash(password) if password else "",
                "role": "user",
                "created_at": datetime.now(timezone.utc),
            }
        )
    except DuplicateKeyError:
        return _json_error("Ye User ID pehle se registered hai.", 409)
    except PyMongoError:
        logger.exception("Failed to create user")
        return _json_error("Could not create the account.", 500)

    created = users_col.find_one({"_id": result.inserted_id})
    return jsonify({
        "success": True,
        "message": f"User ID '{created['username']}' created.",
        "user": {
            "_id": str(created["_id"]),
            "username": created["username"],
            "email": created["email"],
            "role": created.get("role", "user"),
            "created_at": created.get("created_at"),
        },
    }), 201


@app.route("/admin/api/users/<user_id>", methods=["DELETE"])
@admin_required
@csrf_protected
def api_delete_user(user, user_id):
    """Admin kisi account ko delete kar sakta hai. Khud ko nahi, aur last admin ko nahi."""
    if user_id == str(user["_id"]):
        return _json_error("Apna khud ka account delete nahi kar sakte.", 400)

    target = users_col.find_one({"_id": ObjectId(user_id)})
    if target is None:
        return _json_error("Account not found.", 404)

    if target.get("role") == "admin":
        admin_count = users_col.count_documents({"role": "admin"})
        if admin_count <= 1:
            return _json_error("Last admin account delete nahi kar sakte.", 400)

    try:
        users_col.delete_one({"_id": target["_id"]})
    except PyMongoError:
        logger.exception("Failed to delete user %s", user_id)
        return _json_error("Could not delete the account.", 500)

    return jsonify({"success": True, "message": f"Account '{target['username']}' deleted."})


# ---------------------------------------------------------------- Employees (admin)
_EMP_DEPARTMENTS = ("Ticket Booking", "Restaurant", "Tumble Dry")


def _emp_base_username(full_name):
    token = ((full_name or "").strip().split()[0]) if (full_name or "").strip() else ""
    base = re.sub(r"[^A-Za-z]", "", token).upper() or "EMP"
    return base


def _serialize_employee(d):
    emp = d.get("emp") or {}
    return {
        "_id": str(d["_id"]),
        "username": d.get("username"),
        "role": d.get("role", "user"),
        "emp": {
            "full_name": emp.get("full_name", ""),
            "age": emp.get("age", ""),
            "aadhar": emp.get("aadhar", ""),
            "work_exp": emp.get("work_exp", ""),
            "department": emp.get("department", ""),
            "joining_date": emp.get("joining_date", ""),
            "address": emp.get("address", ""),
            "photo": ("/admin/api/employees/%s/photo" % str(d["_id"])) if emp.get("photo_key") else "",
        },
        "created_at": d.get("created_at"),
    }


def _fmt_emp_date(dt_str):
    try:
        y, m, d = str(dt_str).split("-")
        if len(y) == 4:
            return f"{d}-{m}-{y}"
    except Exception:
        pass
    return str(dt_str or "-")


def _rounded_path(c, x, y, w, h, r):
    p = c.beginPath()
    if r <= 0:
        p.rect(x, y, w, h)
        return p
    k = 0.5523
    p.moveTo(x, y + r)
    p.curveTo(x, y + r * (1 - k), x + r * (1 - k), y, x + r, y)
    p.lineTo(x + w - r, y)
    p.curveTo(x + w - r * (1 - k), y, x + w, y + r * (1 - k), x + w, y + r)
    p.lineTo(x + w, y + h - r)
    p.curveTo(x + w, y + h - r * (1 - k), x + w - r * (1 - k), y + h, x + w - r, y + h)
    p.lineTo(x + r, y + h)
    p.curveTo(x + r * (1 - k), y + h, x, y + h - r * (1 - k), x, y + h - r)
    p.close()
    return p


def _emp_barcode(c, x, y, w, h, seed):
    v = 0
    for i, ch in enumerate(str(seed)):
        v = (v * 131 + ord(ch)) & 0x7FFFFFFF
    v = v or 1
    n = 46
    step = w / float(n)
    c.setFillColor(colors.HexColor("#0f172a"))
    for i in range(n):
        bit = (v >> (i % 32)) & 1
        thick = ((v >> ((i + 7) % 31)) & 1) == 1
        if bit:
            bw = step * (1.6 if thick else 0.85)
            c.rect(x + step * i, y, bw, h, stroke=0, fill=1)


def _build_employee_card_pdf(doc):
    from reportlab.lib.utils import ImageReader

    emp = doc.get("emp") or {}
    fname = str(emp.get("full_name") or "-")
    uname = str(doc.get("username") or "-")
    buf = io.BytesIO()
    W, H = A4[1], A4[0]
    CARD_W, CARD_H = 240 * mm, 124 * mm
    R = 6 * mm
    x0 = (W - CARD_W) / 2.0
    y0 = (H - CARD_H) / 2.0
    c = _canvas.Canvas(buf, pagesize=(W, H), title=f"Employee ID Card - {fname}")
    c.setTitle(f"Employee ID Card - {fname}")

    # card body + clip
    p = _rounded_path(c, x0, y0, CARD_W, CARD_H, R)
    c.saveState()
    c.clipPath(p, stroke=0, fill=0)
    c.setFillColor(colors.white)
    c.rect(x0, y0, CARD_W, CARD_H, stroke=0, fill=1)
    # top band (navy) + amber strip
    band_h = 28 * mm
    c.setFillColor(colors.HexColor("#1e3a8a"))
    c.rect(x0, y0 + CARD_H - band_h, CARD_W, band_h, stroke=0, fill=1)
    c.setFillColor(colors.HexColor("#f59e0b"))
    c.rect(x0, y0 + CARD_H - band_h - 2 * mm, CARD_W, 2 * mm, stroke=0, fill=1)
    c.restoreState()
    # border
    c.setStrokeColor(colors.HexColor("#1e3a8a"))
    c.setLineWidth(1.3)
    bb = _rounded_path(c, x0, y0, CARD_W, CARD_H, R)
    c.drawPath(bb, stroke=1, fill=0)

    # band text
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 19)
    c.drawString(x0 + 14 * mm, y0 + CARD_H - 11.5 * mm, "NXTGen PRS")
    c.setFont("Helvetica", 7.5)
    c.setFillColor(colors.HexColor("#c7d2fe"))
    c.drawString(x0 + 14 * mm, y0 + CARD_H - 17.5 * mm, "P R O G R E S S I V E   R A I L   S Y S T E M")
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 12)
    c.drawRightString(x0 + CARD_W - 14 * mm, y0 + CARD_H - 11.5 * mm, "EMPLOYEE ID CARD")
    c.setFont("Helvetica", 7)
    c.setFillColor(colors.HexColor("#c7d2fe"))
    c.drawRightString(x0 + CARD_W - 14 * mm, y0 + CARD_H - 17.5 * mm, "O F F I C I A L   I D E N T I T Y")

    band_bot = y0 + CARD_H - 30 * mm
    body_top = band_bot - 2 * mm

    # photo block
    px, pw = x0 + 14 * mm, 54 * mm
    ph = 62 * mm
    py = body_top - 2 * mm - ph
    c.setFillColor(colors.HexColor("#f1f5f9"))
    c.setStrokeColor(colors.HexColor("#cbd5e1"))
    c.setLineWidth(0.8)
    c.roundRect(px, py, pw, ph, 2.5 * mm, stroke=1, fill=1)
    photo_key = emp.get("photo_key")
    photo_ok = False
    if photo_key:
        try:
            pdata = b2.get_object_bytes(photo_key)
            ir = ImageReader(io.BytesIO(pdata))
            iw, ih = ir.getSize()
            if iw > 0 and ih > 0:
                s = min((pw - 3 * mm) / iw, (ph - 3 * mm) / ih)
                dw, dh = iw * s, ih * s
                c.saveState()
                c.roundRect(px + 1.4 * mm, py + 1.4 * mm, pw - 2.8 * mm, ph - 2.8 * mm, 1.8 * mm, stroke=0, fill=0)
                c.clipPath(_rounded_path(c, px + 1.4 * mm, py + 1.4 * mm, pw - 2.8 * mm, ph - 2.8 * mm, 1.8 * mm),
                           stroke=0, fill=0)
                c.drawImage(ir, px + (pw - dw) / 2.0, py + (ph - dh) / 2.0, dw, dh, preserveAspectRatio=True)
                c.restoreState()
                photo_ok = True
        except Exception:
            photo_ok = False
    if not photo_ok:
        c.setFont("Helvetica", 9)
        c.setFillColor(colors.HexColor("#94a3b8"))
        c.drawCentredString(px + pw / 2.0, py + ph / 2.0 - 3, "PHOTO")

    # details
    dx1 = x0 + 80 * mm
    dx2 = x0 + 160 * mm
    c.setFillColor(colors.HexColor("#0f172a"))
    c.setFont("Helvetica-Bold", 15)
    c.drawString(dx1, body_top - 6 * mm, fname)
    dept = str(emp.get("department") or "-")
    sw = c.stringWidth(dept.upper(), "Helvetica-Bold", 8)
    pill_w = sw + 8 * mm
    pill_h = 5.6 * mm
    c.setFillColor(colors.HexColor("#eff6ff"))
    pillp = _rounded_path(c, dx1, body_top - 13.6 * mm, pill_w, pill_h, 2.8 * mm)
    c.drawPath(pillp, stroke=0, fill=1)
    c.setFillColor(colors.HexColor("#2563eb"))
    c.setFont("Helvetica-Bold", 8)
    c.drawCentredString(dx1 + pill_w / 2.0, body_top - 13.6 * mm + 1.7 * mm, dept.upper())

    grid = [
        (("Employee ID", uname), ("Aadhar No.", str(emp.get("aadhar") or "-"))),
        (("Department", dept), ("Joining Date", _fmt_emp_date(emp.get("joining_date")))),
        (("Experience", str(emp.get("work_exp") or "-")), ("Age", str(emp.get("age") or "-"))),
    ]
    yy = body_top - 22 * mm
    for row in grid:
        for k, (lab, val) in enumerate(row):
            xx = dx1 if k == 0 else dx2
            c.setFillColor(colors.HexColor("#94a3b8"))
            c.setFont("Helvetica", 6.5)
            c.drawString(xx, yy + 3.6 * mm, lab.upper())
            c.setFillColor(colors.HexColor("#0f172a"))
            c.setFont("Helvetica-Bold", 9.5)
            c.drawString(xx, yy, val)
        yy -= 9 * mm
    c.setFillColor(colors.HexColor("#94a3b8"))
    c.setFont("Helvetica", 6.5)
    c.drawString(dx1, yy - 1 * mm, "VALID TILL: PERMANENT  \u2022  OFFICIAL USE ONLY")

    # footer
    c.setStrokeColor(colors.HexColor("#e2e8f0"))
    c.setLineWidth(0.8)
    c.line(x0 + 12 * mm, y0 + 14 * mm, x0 + CARD_W - 12 * mm, y0 + 14 * mm)
    # signature
    c.setFillColor(colors.HexColor("#64748b"))
    c.setFont("Helvetica", 7)
    c.drawString(x0 + 14 * mm, y0 + 7.5 * mm, "Authorized Signature")
    c.setStrokeColor(colors.HexColor("#0f172a"))
    c.setLineWidth(1)
    c.line(x0 + 28 * mm, y0 + 10.5 * mm, x0 + 14 * mm, y0 + 9.5 * mm)
    c.line(x0 + 14 * mm, y0 + 9.5 * mm, x0 + 34 * mm, y0 + 8 * mm)
    c.line(x0 + 34 * mm, y0 + 8 * mm, x0 + 22 * mm, y0 + 7.5 * mm)
    # barcode
    _emp_barcode(c, x0 + CARD_W - 14 * mm - 46 * mm, y0 + 18 * mm, 46 * mm, 9 * mm, uname + (emp.get("aadhar") or ""))
    c.setFillColor(colors.HexColor("#64748b"))
    c.setFont("Helvetica", 6.5)
    c.drawRightString(x0 + CARD_W - 14 * mm, y0 + 15 * mm, uname)
    c.setFillColor(colors.HexColor("#94a3b8"))
    c.setFont("Helvetica", 7)
    c.drawCentredString(x0 + CARD_W / 2.0, y0 + 7 * mm, "NXTGen PRS  \u2022  www.nxtgen.example  \u2022  employee card")

    def _wrap(text, font, size, maxw):
        words = str(text).split()
        lines = []
        cur = ""
        for w in words:
            trial = (cur + " " + w).strip()
            if c.stringWidth(trial, font, size) <= maxw:
                cur = trial
            else:
                if cur:
                    lines.append(cur)
                cur = w
        if cur:
            lines.append(cur)
        return lines or [""]

    # ---- back side: full address ----
    addr = str(emp.get("address") or "-")
    if not addr.strip() or addr == "-":
        addr = "-"
    c.showPage()
    bp = _rounded_path(c, x0, y0, CARD_W, CARD_H, R)
    c.saveState()
    c.clipPath(bp, stroke=0, fill=0)
    c.setFillColor(colors.white)
    c.rect(x0, y0, CARD_W, CARD_H, stroke=0, fill=1)
    c.setFillColor(colors.HexColor("#1e3a8a"))
    c.rect(x0, y0 + CARD_H - band_h, CARD_W, band_h, stroke=0, fill=1)
    c.setFillColor(colors.HexColor("#f59e0b"))
    c.rect(x0, y0 + CARD_H - band_h - 2 * mm, CARD_W, 2 * mm, stroke=0, fill=1)
    c.restoreState()
    c.setStrokeColor(colors.HexColor("#1e3a8a"))
    c.setLineWidth(1.3)
    c.drawPath(_rounded_path(c, x0, y0, CARD_W, CARD_H, R), stroke=1, fill=0)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 19)
    c.drawString(x0 + 14 * mm, y0 + CARD_H - 11.5 * mm, "NXTGen PRS")
    c.setFont("Helvetica", 7.5)
    c.setFillColor(colors.HexColor("#c7d2fe"))
    c.drawString(x0 + 14 * mm, y0 + CARD_H - 17.5 * mm, "P R O G R E S S I V E   R A I L   S Y S T E M")
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 12)
    c.drawRightString(x0 + CARD_W - 14 * mm, y0 + CARD_H - 11.5 * mm, "EMPLOYEE ID CARD")
    c.setFont("Helvetica", 7)
    c.setFillColor(colors.HexColor("#c7d2fe"))
    c.drawRightString(x0 + CARD_W - 14 * mm, y0 + CARD_H - 17.5 * mm, "O F F I C I A L   I D E N T I T Y")

    ax = x0 + 14 * mm
    ay = y0 + CARD_H - 36 * mm
    aw = CARD_W - 28 * mm
    c.setFillColor(colors.HexColor("#64748b"))
    c.setFont("Helvetica", 7.5)
    c.drawString(ax, ay, "PERMANENT ADDRESS")
    box_top = ay - 3 * mm
    box_h = 56 * mm
    c.setFillColor(colors.HexColor("#f8fafc"))
    c.setStrokeColor(colors.HexColor("#cbd5e1"))
    c.setLineWidth(0.8)
    c.roundRect(ax, box_top - box_h, aw, box_h, 3 * mm, stroke=1, fill=1)
    lines = _wrap(addr, "Helvetica-Bold", 13, aw - 18 * mm)
    if addr == "-":
        lines = ["-"]
    c.setFillColor(colors.HexColor("#0f172a"))
    c.setFont("Helvetica-Bold", 13)
    ly = box_top - 10 * mm
    for line in lines:
        c.drawString(ax + 9 * mm, ly, line)
        ly -= 8 * mm
    c.setFillColor(colors.HexColor("#94a3b8"))
    c.setFont("Helvetica", 6.5)
    c.drawString(ax, box_top - box_h - 5 * mm, "KEEP THIS CARD SAFE  \u2022  REPORT LOSS IMMEDIATELY TO ADMIN")
    _emp_barcode(c, x0 + CARD_W - 14 * mm - 46 * mm, y0 + 18 * mm, 46 * mm, 9 * mm,
                 uname + (emp.get("aadhar") or "") + addr)
    c.setFillColor(colors.HexColor("#64748b"))
    c.setFont("Helvetica", 6.5)
    c.drawRightString(x0 + CARD_W - 14 * mm, y0 + 15 * mm, uname)
    c.setFillColor(colors.HexColor("#94a3b8"))
    c.setFont("Helvetica", 6.5)
    c.drawCentredString(x0 + CARD_W / 2.0, y0 + 7 * mm,
                        "This card remains the property of NXTGen Group.")
    c.showPage()
    c.save()
    buf.seek(0)
    return buf


@app.route("/admin/api/employees", methods=["GET"])
@admin_required
def api_list_employees(user):
    """Admin-only: sabhi employees ki list (emp profile wale accounts)."""
    try:
        docs = list(users_col.find({"emp": {"$exists": True}}).sort("created_at", -1))
    except PyMongoError:
        logger.exception("Failed to list employees")
        return _json_error("Could not read the database.", 500)
    return jsonify({"success": True, "employees": [_serialize_employee(d) for d in docs]})


@app.route("/admin/api/employees", methods=["POST"])
@admin_required
@csrf_protected
def api_create_employee(user):
    """Admin employee banata hai: full profile + login ID (NAME+Age) + password."""
    form = request.form
    full_name = (form.get("full_name") or "").strip()
    age = (form.get("age") or "").strip()
    aadhar = re.sub(r"\D", "", form.get("aadhar") or "")
    work_exp = (form.get("work_exp") or "").strip()
    department = (form.get("department") or "").strip()
    joining_date = (form.get("joining_date") or "").strip()
    address = (form.get("address") or "").strip()
    password = form.get("password") or ""
    if len(full_name) < 2 or not age.isdigit() or len(aadhar) != 12:
        return _json_error("Full Name, Age aur 12-digit Aadhar No. dein.", 400)
    if len(address) < 5:
        return _json_error("Address daalein (kam se kam 5 letters).", 400)
    if department not in _EMP_DEPARTMENTS:
        return _json_error("Department galat hai (Ticket Booking/Restaurant/Tumble Dry).", 400)
    if len(password) < 4:
        return _json_error("Password kam se kam 4 characters ka rakhein.", 400)
    if len(joining_date) < 8:
        return _json_error("Joining Date chahiye (YYYY-MM-DD).", 400)

    base = _emp_base_username(full_name)
    uname = f"{base}{age}"
    i = 2
    while users_col.find_one({"username": uname}):
        uname = f"{base}{age}{i}"
        i += 1

    emp_doc = {
        "full_name": full_name,
        "age": age,
        "aadhar": aadhar,
        "work_exp": work_exp,
        "department": department,
        "joining_date": joining_date,
        "address": address,
        "photo_key": None,
        "photo_ct": None,
    }
    photo_data = b""
    photo_key = ""
    photo_ct = ""
    file = request.files.get("photo")
    if file is not None and file.filename:
        fname98 = (file.filename or "").lower()
        ext = fname98.rsplit(".", 1)[-1] if "." in fname98 else ""
        photo_ct = _CHAT_IMAGE_TYPES.get(ext)
        if photo_ct is None:
            return _json_error("Photo sirf PNG, JPG, GIF, WEBP ho sakti hai.", 400)
        photo_data = file.read()
        if not photo_data:
            return _json_error("Photo khali hai.", 400)
        if len(photo_data) > 5 * 1024 * 1024:
            return _json_error("Photo 5MB se bada hai.", 400)

    oid = ObjectId()
    doc = {
        "_id": oid,
        "username": uname,
        "email": None,
        "password_hash": generate_password_hash(password),
        "role": "user",
        "emp": emp_doc,
        "created_at": datetime.now(timezone.utc),
    }
    if photo_data:
        key = f"emp/{oid}{('.' + ext) if photo_ct else ''}"
        doc["emp"]["photo_key"] = key
        doc["emp"]["photo_ct"] = photo_ct
        photo_key, photo_ct2 = key, photo_ct
    try:
        users_col.insert_one(doc)
    except DuplicateKeyError:
        logger.exception("Employee username collision: %s", uname)
        return _json_error("Ye Employee ID pehle se hai.", 409)
    except PyMongoError:
        logger.exception("Could not create employee")
        return _json_error("Employee create nahi hua.", 500)
    if photo_data:
        try:
            b2.upload_bytes(photo_data, photo_key, photo_ct2)
        except B2Error as exc:
            logger.error("Could not upload employee photo: %s", exc)
            try:
                users_col.delete_one({"_id": oid})
            except PyMongoError:
                pass
            return _json_error("Photo upload nahi hui.", exc.status_code)
    created = users_col.find_one({"_id": oid})
    return jsonify({
        "success": True,
        "message": f"Employee '{uname}' ({full_name}) ban gaya.",
        "employee": _serialize_employee(created),
    }), 201


@app.route("/admin/api/employees/<eid>/password", methods=["POST"])
@admin_required
@csrf_protected
def api_employee_password(user, eid):
    """Admin kabhi bhi employee ka password change kar sakta hai."""
    try:
        oid = ObjectId(eid)
    except (InvalidId, TypeError):
        return _json_error("Invalid id.", 400)
    target = users_col.find_one({"_id": oid})
    if target is None or not target.get("emp"):
        return _json_error("Employee nahi mila.", 404)
    data = request.get_json(silent=True) or {}
    new_pw = (data.get("password") or "").strip()
    if len(new_pw) < 4:
        return _json_error("Password kam se kam 4 characters ka ho.", 400)
    try:
        users_col.update_one({"_id": oid}, {"$set": {"password_hash": generate_password_hash(new_pw)}})
    except PyMongoError:
        logger.exception("Could not update employee password")
        return _json_error("Password update nahi hua.", 500)
    return jsonify({"success": True, "message": f"{target['username']} ka password change ho gaya."})


@app.route("/admin/api/employees/<eid>/photo", methods=["GET"])
@admin_required
def api_employee_photo(user, eid):
    try:
        oid = ObjectId(eid)
    except (InvalidId, TypeError):
        return _json_error("Invalid id.", 400)
    target = users_col.find_one({"_id": oid})
    if target is None or not target.get("emp"):
        return _json_error("Employee nahi mila.", 404)
    key = (target.get("emp") or {}).get("photo_key")
    if not key:
        return _json_error("Photo nahi hai.", 404)
    try:
        data = b2.get_object_bytes(key)
    except B2Error as exc:
        logger.error("Could not fetch employee photo %s: %s", key, exc)
        return _json_error(exc.message, exc.status_code)
    return send_file(io.BytesIO(data), mimetype=(target.get("emp") or {}).get("photo_ct", "image/jpeg"),
                     download_name="employee_photo", max_age=3600)


@app.route("/admin/api/employees/<eid>/card", methods=["GET"])
@admin_required
def api_employee_card(user, eid):
    try:
        oid = ObjectId(eid)
    except (InvalidId, TypeError):
        return _json_error("Invalid id.", 400)
    target = users_col.find_one({"_id": oid})
    if target is None or not target.get("emp"):
        return _json_error("Employee nahi mila.", 404)
    try:
        buf = _build_employee_card_pdf(target)
    except Exception:
        logger.exception("Employee card PDF failed")
        return _json_error("Card ban nahi paya.", 500)
    fname = f"EmpCard-{target.get('username', 'EMP')}.pdf"
    return send_file(buf, mimetype="application/pdf", download_name=fname, as_attachment=True, max_age=0)


# ---------------------------------------------------------------- Tickets / Fresh IDs (killer.py port)
_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
STATIONS = []
TRAINS = []


def _load_stations():
    path = os.path.join(_DATA_DIR, "stations.json")
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        out = []
        for item in data:
            if isinstance(item, str):
                out.append(item.upper())
            elif isinstance(item, dict) and item.get("name") and item.get("code"):
                out.append(f"{item['name'].upper()} - {item['code'].upper()}")
        return out
    except Exception:
        logger.exception("Could not load stations.json")
        return []


def _load_trains():
    path = os.path.join(_DATA_DIR, "trainlist_cache.txt")
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            txt = f.read()
        out = []
        for line in txt.splitlines():
            line = line.strip()
            if not line or "-" not in line:
                continue
            num, name = line.split("-", 1)
            num = num.strip()
            name = name.strip()
            if num and name:
                out.append(f"{num} - {name}")
        return out
    except Exception:
        logger.exception("Could not load trainlist_cache.txt")
        return []


STATIONS = _load_stations()
TRAINS = _load_trains()


def _load_payment_modes():
    path = os.path.join(_DATA_DIR, "payment_modes.json")
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return [str(x) for x in data if str(x).strip()]
    except Exception:
        return ["UPI_ID_Manual", "IRCTC_iPay_SCAN", "PhonePe_QR"]


PAYMENT_MODES = _load_payment_modes()
logger.info("Loaded %d stations and %d trains", len(STATIONS), len(TRAINS))


def _serialize_ticket(doc):
    return {
        "id": str(doc["_id"]),
        "t_name": doc.get("t_name", ""),
        "src": doc.get("src", ""),
        "dst": doc.get("dst", ""),
        "train": doc.get("train", ""),
        "cls": doc.get("cls", ""),
        "date": doc.get("date", ""),
        "boarding": doc.get("boarding", ""),
        "mobile": doc.get("mobile", ""),
        "alt_mobile": doc.get("alt_mobile", ""),
        "slot_id": doc.get("slot_id", ""),
        "pay": doc.get("pay", ""),
        "pay_mode": doc.get("pay_mode", ""),
        "total": doc.get("total", ""),
        "adv_amount": doc.get("adv_amount", ""),
        "desc": doc.get("desc", ""),
        "passengers": doc.get("passengers", []),
        "quota": doc.get("quota", "GN"),
        "train_type": doc.get("train_type", ""),
        "booked": bool(doc.get("booked", False)),
        "confirm_only": doc.get("confirm_only", True),
        "skip_food": doc.get("skip_food", False),
        "starred": bool(doc.get("starred", False)),
        "pt_limit": doc.get("pt_limit", "0"),
        "avail_info": doc.get("avail_info"),
        "username": doc.get("username", ""),
        "emp_name": doc.get("emp_name", doc.get("username", "")),
        "created_at": doc.get("created_at"),
    }


def _serialize_fresh_id(doc):
    return {
        "id": str(doc["_id"]),
        "user_id_value": doc.get("user_id_value", ""),
        "password": doc.get("password", ""),
        "owner": doc.get("owner", ""),
        "created_at": doc.get("created_at"),
    }


@app.route("/ticket/new")
@login_required
def new_ticket_page(user):
    return render_template("new_ticket.html", user=user, payment_modes=PAYMENT_MODES)


@app.route("/api/stations")
@login_required
def api_stations(user):
    q = (request.args.get("q") or "").strip().upper()
    if not q:
        return jsonify({"success": True, "items": []})
    exact, code_starts, name_starts, others = [], [], [], []
    for stn in STATIONS:
        if q not in stn:
            continue
        parts = stn.split(" - ")
        code = parts[-1].strip() if len(parts) > 1 else ""
        name = parts[0].strip()
        if code == q:
            exact.append(stn)
        elif code.startswith(q):
            code_starts.append(stn)
        elif name.startswith(q):
            name_starts.append(stn)
        else:
            others.append(stn)
    items = (exact + code_starts + name_starts + others)[:8]
    return jsonify({"success": True, "items": items})


@app.route("/api/trains")
@login_required
def api_trains(user):
    q = (request.args.get("q") or "").strip().upper()
    if not q:
        return jsonify({"success": True, "items": []})
    num_starts, name_starts, others = [], [], []
    for tr in TRAINS:
        up = tr.upper()
        if q not in up:
            continue
        parts = tr.split(" - ", 1)
        num = parts[0].strip()
        name = parts[1].strip() if len(parts) > 1 else ""
        if num.startswith(q):
            num_starts.append(tr)
        elif name.startswith(q):
            name_starts.append(tr)
        else:
            others.append(tr)
    items = (num_starts + name_starts + others)[:10]
    return jsonify({"success": True, "items": items})


@app.route("/api/train-search")
@login_required
def api_train_search(user):
    src = (request.args.get("from") or "").strip().upper()
    dst = (request.args.get("to") or "").strip().upper()
    date = (request.args.get("date") or "").strip()
    src = src.split(" - ")[-1].strip() if " - " in src else src
    dst = dst.split(" - ")[-1].strip() if " - " in dst else dst
    if not src or not dst:
        return jsonify({"success": False, "error": "From aur To dono chahiye."}), 400

    url = (
        "https://erail.in/rail/getTrains.aspx?"
        f"Station_From={urllib.parse.quote(src)}&Station_To={urllib.parse.quote(dst)}"
        "&DataSource=0&Language=0&Cache=true"
    )
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                "Referer": "https://erail.in/",
            },
        )
        with urllib.request.urlopen(req, timeout=25) as resp:
            text = resp.read().decode("utf-8", errors="ignore")
    except Exception:
        logger.exception("Train search network error")
        return jsonify({"success": False, "error": "Train list nahi mili (network issue)."}), 502

    wdab = ["M", "T", "W", "TH", "F", "S", "SU"]
    wd = ""
    try:
        p = date.replace("-", "/").split("/")
        if len(p) == 3:
            for trial in (p, [p[1], p[2], p[0]], [p[2], p[1], p[0]]):
                try:
                    r = datetime(int(trial[0]), int(trial[1]), int(trial[2]))
                    wd = wdab[r.weekday()]
                    break
                except ValueError:
                    continue
    except Exception:
        wd = ""

    clsbits = ["1A", "2A", "3A", "CC", "FC", "SL", "2S", "3E", "", "EA", "EC", "EV"]
    trains = []
    for rec in text.split("^")[1:]:
        f = rec.split("~")
        try:
            num = f[0].strip()
            if not num.isdigit() or len(f) < 22:
                continue
            days = (f[13] + "0000000")[:7]
            if wd and days[wdab.index(wd)] != "1":
                continue
            bits = (f[21] + "000000000000")[:12]
            have = [clsbits[k] for k in range(12) if bits[k] == "1" and clsbits[k]]
            trains.append({
                "num": num,
                "name": f[1].strip(),
                "from": f[7].strip(),
                "depart": f[10].strip(),
                "to": f[9].strip(),
                "arrive": f[11].strip(),
                "duration": f[12].strip(),
                "days": days,
                "classes": have,
            })
        except Exception:
            continue
    return jsonify({"success": True, "trains": trains})


def _fetch_erail_availability(train_no, frm, to, cls, quota, date_iso):
    """erail se availability + fare (killer.py jaisa, bina API key). Returns (status, fare)."""
    try:
        cookies = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(cookies)
        )
        opener.addheaders = [
            ("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"),
            ("Accept", "application/json"),
        ]
        try:
            opener.open("https://erail.in/", timeout=12)
        except Exception:
            pass

        p = (date_iso or "").split("-")
        if len(p) != 3:
            return ("", "")
        lab = f"{int(p[2])}-{int(p[1])}"
        key = f"{train_no}_{frm}_{to}_{cls}_{quota}_{lab}"
        data = "~".join([key, key + "_f"])
        body = json.dumps({"Action": "FETCH_SEAT_AVAILABILITY", "Data": data}).encode("utf-8")
        req = urllib.request.Request(
            "https://s.erail.in/getvalue",
            data=body,
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "Accept": "application/json",
                "Origin": "https://erail.in",
                "Referer": "https://erail.in/",
            },
        )
        with opener.open(req, timeout=20) as resp:
            obj = json.loads(resp.read().decode("utf-8", "ignore"))
        ds = (obj.get("data") or obj.get("Data") or "").strip()
        if not ds:
            return ("", "")
        status = ""
        fare = ""
        for seg in ds.split("~"):
            sub = seg.split("^")
            if len(sub) < 2 or not sub[0]:
                continue
            if sub[0] == key:
                status = sub[1] if len(sub) >= 2 and sub[1] else ""
            elif sub[0] == key + "_f":
                raw = sub[1]
                fare = raw.split("_")[0] if raw else ""
        if status and not fare:
            try:
                body2 = json.dumps({"Action": "FETCH_SEAT_AVAILABILITY", "Data": key + "_f"}).encode("utf-8")
                req2 = urllib.request.Request(
                    "https://s.erail.in/getvalue",
                    data=body2,
                    headers={
                        "Content-Type": "application/json; charset=utf-8",
                        "Accept": "application/json",
                        "Origin": "https://erail.in",
                        "Referer": "https://erail.in/",
                    },
                )
                with opener.open(req2, timeout=20) as resp2:
                    obj2 = json.loads(resp2.read().decode("utf-8", "ignore"))
                ds2 = (obj2.get("data") or obj2.get("Data") or "").strip()
                for seg2 in ds2.split("~"):
                    sub2 = seg2.split("^")
                    if len(sub2) >= 2 and sub2[0] == key + "_f":
                        raw2 = sub2[1]
                        f2 = raw2.split("_")[0] if raw2 else ""
                        if f2:
                            fare = f2
                            break
            except Exception:
                pass
        return (status, fare)
    except Exception:
        return ("", "")


_IR_FEED_CACHE = None
_IR_FEED_TS = 0
_IR_FEED_TTL = 6 * 3600
_IR_TESSERACT = r"C:\Users\ASHISH KUMAR\OneDrive\Desktop\KILLER SUCCESS\Tesseract-OCR\tesseract.exe"


def _ir_feed_maps(timeout=15):
    """IndianRail ke FetchAutoComplete/FetchTrainData feeds se code/train -> "FULL - CODE" maps (cached 6h)."""
    global _IR_FEED_CACHE, _IR_FEED_TS
    import requests as _req
    now = time.time()
    if _IR_FEED_CACHE is not None and (now - _IR_FEED_TS) < _IR_FEED_TTL:
        return _IR_FEED_CACHE
    stn, trn = {}, {}
    try:
        s = _req.Session()
        s.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json;charset=UTF-8",
        })
        for e in s.get("https://www.indianrail.gov.in/enquiry/FetchAutoComplete", timeout=timeout).json():
            if " - " in e:
                stn[e.rsplit(" - ", 1)[-1].strip().upper()] = e
        for t in s.get("https://www.indianrail.gov.in/enquiry/FetchTrainData", timeout=timeout).json():
            if " - " in t:
                trn[t.split(" - ", 1)[0].strip()] = t
        _IR_FEED_CACHE = (stn, trn)
        _IR_FEED_TS = time.time()
    except Exception:
        _IR_FEED_CACHE = _IR_FEED_CACHE or ({}, {})
    return _IR_FEED_CACHE


def _ir_station_full(code):
    code = (code or "").strip().upper()
    if not code:
        return code
    try:
        stn, _ = _ir_feed_maps()
        if code in stn:
            return stn[code]
    except Exception:
        pass
    return code


def _ir_train_full(num, name=""):
    num = (num or "").strip()
    name = (name or "").strip()
    try:
        _, trn = _ir_feed_maps()
        if num in trn:
            return trn[num]
    except Exception:
        pass
    if name:
        return f"{num} - {name.upper()}"
    return num


def _ir_solve_captcha(session):
    import io
    try:
        from PIL import Image, ImageOps
        import pytesseract
        pytesseract.pytesseract.tesseract_cmd = _IR_TESSERACT
        png = session.get("https://www.indianrail.gov.in/enquiry/captchaDraw.png", timeout=20).content
        im = Image.open(io.BytesIO(png)).convert("RGBA")
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[3])
        g = bg.convert("L").resize((im.width * 5, im.height * 5))
        g = ImageOps.autocontrast(g, cutoff=1)
        raw = pytesseract.image_to_string(
            g, config="--oem 3 --psm 7 -c tessedit_char_whitelist=0123456789+-="
        ).strip()
        expr = raw.split("=")[0]
        expr = expr.replace(" ", "").replace("\n", "")
        expr = "".join(c for c in expr if c in "0123456789+-")
        if not expr or not all(x in "+-" for x in expr if not x.isdigit()):
            return ""
        if expr.count("+") > 1 or expr.count("-") > 1:
            return ""
        return str(eval(expr))
    except Exception:
        return ""


def fetch_indianrail_availability(train_no, frm, to, cls, quota, date_ddmmyyyy, train_name=""):
    """Indian Rail (indianrail.gov.in) se availability + fare. Returns (status, fare)."""
    import time as _time
    import requests
    try:
        res = requests.get("https://www.indianrail.gov.in/enquiry/", timeout=25)
        if res.status_code != 200:
            return ("", "")
    except Exception:
        return ("", "")

    tn = _ir_train_full(train_no, train_name)
    src = _ir_station_full(frm)
    dst = _ir_station_full(to)
    if not tn or not src or not dst:
        return ("", "")

    for _try in range(2):
        try:
            s = requests.Session()
            s.headers.update({
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            })
            s.get("https://www.indianrail.gov.in/enquiry/SEAT/SeatAvailability.html?locale=en", timeout=25)
            base = {
                "trainNo": tn,
                "dt": date_ddmmyyyy,
                "sourceStation": src,
                "destinationStation": dst,
                "classc": cls,
                "quota": quota,
                "language": "en",
                "inputPnrNo": "",
            }
            status = ""
            ans = _ir_solve_captcha(s)
            if ans:
                ps = dict(base)
                ps["inputPage"] = "SEAT"
                ps["inputCaptcha"] = ans
                ps["_"] = int(_time.time() * 1000)
                j = s.get("https://www.indianrail.gov.in/enquiry/CommonCaptcha", params=ps, timeout=30).json()
                em = (j.get("errorMessage") or "").strip()
                if not em:
                    av = j.get("avlDayList") or []
                    if av:
                        p = date_ddmmyyyy.split("-")
                        iso = f"{p[2]}-{p[1]}-{p[0]}" if len(p) == 3 else ""
                        hit = next((d for d in av if d.get("availablityDate") == iso), av[0])
                        status = hit.get("availablityStatus", "") or ""
            fare = ""
            if status:
                ans2 = _ir_solve_captcha(s)
                if ans2:
                    pf = dict(base)
                    pf["inputPage"] = "FARE"
                    pf["inputCaptcha"] = ans2
                    pf["_"] = int(_time.time() * 1000)
                    jf = s.get("https://www.indianrail.gov.in/enquiry/CommonCaptcha", params=pf, timeout=30).json()
                    if not (jf.get("errorMessage") or "").strip():
                        tf = jf.get("totalFare")
                        fare = str(tf) if tf not in (None, "", 0) else ""
                        if not fare:
                            bf = jf.get("baseFare")
                            fare = str(bf) if bf not in (None, "", 0) else ""
            if status or fare:
                return (status, fare)
        except Exception:
            continue
    return ("", "")


@app.route("/api/train-avail")
@login_required
def api_train_avail(user):
    train = (request.args.get("train") or "").strip()
    train_name = (request.args.get("name") or "").strip()
    frm = (request.args.get("from") or "").strip()
    to = (request.args.get("to") or "").strip()
    cls = (request.args.get("cls") or "SL").strip()
    quota = (request.args.get("quota") or "GN").strip()
    date = (request.args.get("date") or "").strip()
    frm = frm.split(" - ")[-1].strip() if " - " in frm else frm
    to = to.split(" - ")[-1].strip() if " - " in to else to
    if not train or not frm or not to:
        return jsonify({"success": False, "error": "Train, From aur To chahiye."}), 400
    if not date:
        date = datetime.now(timezone(timedelta(hours=5, minutes=30))).strftime("%Y-%m-%d")
    status, fare = "", ""
    p = date.split("-")
    if len(p) == 3:
        date_ddmmyyyy = f"{int(p[2]):02d}-{int(p[1]):02d}-{p[0]}"
        status, fare = fetch_indianrail_availability(train, frm, to, cls, quota, date_ddmmyyyy, train_name)
    if not status or not fare:
        er_status, er_fare = _fetch_erail_availability(train, frm, to, cls, quota, date)
        if not status:
            status = er_status
        if not fare:
            fare = er_fare
    return jsonify({"success": True, "status": status or "Not Available", "fare": fare})


@app.route("/api/tickets", methods=["GET"])
@login_required
def api_list_tickets(user):
    docs = tickets_col.find({"user_id": str(user["_id"])}).sort("created_at", -1)
    return jsonify({"success": True, "tickets": [_serialize_ticket(d) for d in docs]})


@app.route("/api/tickets", methods=["POST"])
@login_required
@csrf_protected
def api_create_ticket(user):
    data = request.get_json(silent=True) or request.form
    t_name = (data.get("t_name") or "").strip()
    train = (data.get("train") or "").strip()
    mobile = (data.get("mobile") or "").strip()
    if not t_name or not train:
        return jsonify({"success": False, "error": "Target Name aur Train No. daalna zaroori hai."}), 400
    if len(mobile) != 10 or not mobile.isdigit():
        return jsonify({"success": False, "error": "Mobile number 10 digits ka hona chahiye."}), 400

    passengers = data.get("passengers") or []
    if isinstance(passengers, str):
        try:
            passengers = json.loads(passengers)
        except Exception:
            passengers = []

    avail = data.get("avail")
    avail_info = None
    if isinstance(avail, dict):
        cleaned = {}
        for k in ("train", "cls", "quota", "fare", "status", "date"):
            if k in avail and avail[k] not in (None, ""):
                cleaned[k] = str(avail[k])[:200]
        if cleaned.get("fare") and cleaned.get("status"):
            avail_info = cleaned

    doc = {
        "user_id": str(user["_id"]),
        "username": user.get("username", ""),
        "emp_name": (user.get("emp") or {}).get("full_name") or user.get("username", ""),
        "t_name": t_name,
        "src": (data.get("src") or "").strip(),
        "dst": (data.get("dst") or "").strip(),
        "train": train,
        "cls": (data.get("cls") or "SL").strip(),
        "date": (data.get("date") or "").strip(),
        "boarding": (data.get("boarding") or "").strip(),
        "mobile": mobile,
        "alt_mobile": (data.get("alt_mobile") or "").strip(),
        "slot_id": (data.get("slot_id") or "").strip(),
        "pay": (data.get("pay") or "").strip(),
        "pay_mode": (data.get("pay_mode") or "").strip(),
        "total": (data.get("total") or "").strip(),
        "adv_amount": (data.get("adv_amount") or "").strip(),
        "desc": (data.get("desc") or "").strip(),
        "passengers": passengers,
        "quota": (data.get("quota") or "GN").strip(),
        "train_type": (data.get("train_type") or "").strip(),
        "confirm_only": bool(data.get("confirm_only", True)),
        "skip_food": bool(data.get("skip_food", False)),
        "starred": bool(data.get("starred", False)),
        "pt_limit": str(data.get("pt_limit") or "0").strip(),
        "created_at": datetime.now(timezone.utc),
    }
    if avail_info:
        doc["avail_info"] = avail_info
    try:
        result = tickets_col.insert_one(doc)
    except PyMongoError:
        logger.exception("Could not save ticket")
        return jsonify({"success": False, "error": "Ticket save nahi ho saki."}), 500
    doc["_id"] = result.inserted_id
    return jsonify({"success": True, "message": f"Ticket '{t_name}' save ho gayi.", "ticket": _serialize_ticket(doc)}), 201


@app.route("/api/tickets/<ticket_id>", methods=["DELETE"])
@login_required
@csrf_protected
def api_delete_ticket(user, ticket_id):
    try:
        oid = ObjectId(ticket_id)
    except (InvalidId, TypeError):
        return jsonify({"success": False, "error": "Invalid ticket id."}), 400
    doc = tickets_col.find_one({"_id": oid})
    if doc is None:
        return jsonify({"success": False, "error": "Ticket not found."}), 404
    if doc.get("user_id") != str(user["_id"]) and user.get("role") != "admin":
        return jsonify({"success": False, "error": "Is ticket ko delete karne ki permission nahi hai."}), 403
    try:
        tickets_col.delete_one({"_id": oid})
    except PyMongoError:
        logger.exception("Could not delete ticket")
        return jsonify({"success": False, "error": "Ticket delete nahi ho saki."}), 500
    return jsonify({"success": True, "message": "Ticket deleted."})


@app.route("/api/tickets/<ticket_id>/booked", methods=["POST"])
@login_required
@csrf_protected
def api_toggle_booked(user, ticket_id):
    """Star/booked toggle — ticket book ho jaye to green star lagao."""
    try:
        oid = ObjectId(ticket_id)
    except (InvalidId, TypeError):
        return jsonify({"success": False, "error": "Invalid ticket id."}), 400
    doc = tickets_col.find_one({"_id": oid})
    if doc is None:
        return jsonify({"success": False, "error": "Ticket not found."}), 404
    if doc.get("user_id") != str(user["_id"]) and user.get("role") != "admin":
        return jsonify({"success": False, "error": "Is ticket ko update karne ki permission nahi hai."}), 403
    booked = bool(request.get_json(silent=True) and request.get_json(silent=True).get("booked"))
    try:
        tickets_col.update_one({"_id": oid}, {"$set": {"booked": booked}})
    except PyMongoError:
        logger.exception("Could not update ticket")
        return jsonify({"success": False, "error": "Ticket update nahi ho saki."}), 500
    doc["booked"] = booked
    return jsonify({"success": True, "message": "Booked status update ho gayi.", "ticket": _serialize_ticket(doc)})


@app.route("/api/tickets/<ticket_id>", methods=["GET"])
@login_required
def api_get_ticket(user, ticket_id):
    try:
        oid = ObjectId(ticket_id)
    except (InvalidId, TypeError):
        return jsonify({"success": False, "error": "Invalid ticket id."}), 400
    doc = tickets_col.find_one({"_id": oid})
    if doc is None:
        return jsonify({"success": False, "error": "Ticket not found."}), 404
    if doc.get("user_id") != str(user["_id"]) and user.get("role") != "admin":
        return jsonify({"success": False, "error": "Permission nahi hai."}), 403
    return jsonify({"success": True, "ticket": _serialize_ticket(doc)})


@app.route("/api/tickets/<ticket_id>", methods=["PUT"])
@login_required
@csrf_protected
def api_update_ticket(user, ticket_id):
    try:
        oid = ObjectId(ticket_id)
    except (InvalidId, TypeError):
        return jsonify({"success": False, "error": "Invalid ticket id."}), 400
    doc = tickets_col.find_one({"_id": oid})
    if doc is None:
        return jsonify({"success": False, "error": "Ticket not found."}), 404
    if doc.get("user_id") != str(user["_id"]) and user.get("role") != "admin":
        return jsonify({"success": False, "error": "Is ticket ko update karne ki permission nahi hai."}), 403

    data = request.get_json(silent=True) or request.form
    t_name = (data.get("t_name") or "").strip()
    train = (data.get("train") or "").strip()
    mobile = (data.get("mobile") or "").strip()
    if not t_name or not train:
        return jsonify({"success": False, "error": "Target Name aur Train No. daalna zaroori hai."}), 400
    if len(mobile) != 10 or not mobile.isdigit():
        return jsonify({"success": False, "error": "Mobile number 10 digits ka hona chahiye."}), 400

    passengers = data.get("passengers") or []
    if isinstance(passengers, str):
        try:
            passengers = json.loads(passengers)
        except Exception:
            passengers = []

    avail = data.get("avail")
    avail_info = None
    if isinstance(avail, dict):
        cleaned = {}
        for k in ("train", "cls", "quota", "fare", "status", "date"):
            if k in avail and avail[k] not in (None, ""):
                cleaned[k] = str(avail[k])[:200]
        if cleaned.get("fare") and cleaned.get("status"):
            avail_info = cleaned

    updates = {
        "t_name": t_name,
        "src": (data.get("src") or "").strip(),
        "dst": (data.get("dst") or "").strip(),
        "train": train,
        "cls": (data.get("cls") or "SL").strip(),
        "date": (data.get("date") or "").strip(),
        "boarding": (data.get("boarding") or "").strip(),
        "mobile": mobile,
        "alt_mobile": (data.get("alt_mobile") or "").strip(),
        "slot_id": (data.get("slot_id") or "").strip(),
        "pay": (data.get("pay") or "").strip(),
        "pay_mode": (data.get("pay_mode") or "").strip(),
        "total": (data.get("total") or "").strip(),
        "adv_amount": (data.get("adv_amount") or "").strip(),
        "desc": (data.get("desc") or "").strip(),
        "passengers": passengers,
        "quota": (data.get("quota") or "GN").strip(),
        "train_type": (data.get("train_type") or "").strip(),
        "confirm_only": bool(data.get("confirm_only", doc.get("confirm_only", True))),
        "skip_food": bool(data.get("skip_food", doc.get("skip_food", False))),
        "starred": bool(data.get("starred", doc.get("starred", False))),
        "pt_limit": str(data.get("pt_limit") or "0").strip(),
        "updated_at": datetime.now(timezone.utc),
    }
    if avail_info:
        updates["avail_info"] = avail_info
    else:
        updates["avail_info"] = None
    try:
        tickets_col.update_one({"_id": oid}, {"$set": updates})
    except PyMongoError:
        logger.exception("Could not update ticket")
        return jsonify({"success": False, "error": "Ticket update nahi ho saki."}), 500
    updated = tickets_col.find_one({"_id": oid})
    return jsonify({"success": True, "message": f"Ticket '{t_name}' update ho gayi.", "ticket": _serialize_ticket(updated)})


# ---------------------------------------------------------------- Orders PDF export
def _pdf_esc(text):
    return str(text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _build_orders_pdf(docs, label=""):
    page_w, page_h = A4
    left_m = right_m = 2
    top_m = 15
    bottom_m = 2
    gap = 2
    grid_x = 3
    grid_y = 4
    col_w = (page_w - left_m - right_m - (grid_x - 1) * gap) / grid_x
    us_h = page_h - top_m - bottom_m
    card_h = (us_h - grid_y * 2) / grid_y - 6

    total_pax = sum(len((d.get("passengers") or [])) for d in docs)
    sub = f"Date: {label}" if label else "All Orders"

    hA = ParagraphStyle("cA", fontName=_FONT_BOLD, fontSize=9.5, leading=11.5,
                        textColor=colors.HexColor("#1e40af"))
    hB = ParagraphStyle("cB", fontName=_FONT_BOLD, fontSize=7, leading=8.4,
                        textColor=colors.HexColor("#0f172a"))
    cS = ParagraphStyle("cS", fontName=_FONT_NORMAL, fontSize=6.8, leading=8.2,
                        textColor=colors.HexColor("#334155"))
    pS = ParagraphStyle("cP", fontName=_FONT_NORMAL, fontSize=7, leading=8.4,
                        textColor=colors.HexColor("#0f172a"))
    fS = ParagraphStyle("cF", fontName=_FONT_ITALIC, fontSize=6.2, leading=7.6,
                        textColor=colors.HexColor("#64748b"))
    hDR = ParagraphStyle("hDR", fontName=_FONT_BOLD, fontSize=8.5, leading=10,
                         textColor=colors.white)
    paxHD = ParagraphStyle("pHD", fontName=_FONT_BOLD, fontSize=6.5, leading=8,
                           textColor=colors.HexColor("#1e3a8a"), alignment=1)
    paxNM = ParagraphStyle("pNM", fontName=_FONT_NORMAL, fontSize=7, leading=8.4,
                           textColor=colors.HexColor("#0f172a"))
    paxCE = ParagraphStyle("pCE", fontName=_FONT_NORMAL, fontSize=6.5, leading=8,
                           textColor=colors.HexColor("#334155"), alignment=1)

    def _jdate(dt_str):
        try:
            y, m, d = str(dt_str).split("-")
            if len(y) == 4:
                return f"{d}-{m}-{y}"
        except Exception:
            pass
        return str(dt_str)

    def _saved_time(created):
        if isinstance(created, datetime):
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            created = created.astimezone(timezone(timedelta(hours=5, minutes=30)))
            return created.strftime("%d-%m-%Y %H:%M")
        return "-"

    def _card(d, num):
        train = _pdf_esc(str(d.get("train") or "-").strip())
        cls = _pdf_esc(str(d.get("cls") or "-").strip())
        quota = _pdf_esc(str(d.get("quota") or "GN").strip())
        jd = _pdf_esc(_jdate(d.get("date")))
        mob = _pdf_esc(str(d.get("mobile") or "-"))
        ai = d.get("avail_info") or {}
        fare = _pdf_esc(str(ai.get("fare") or "-"))
        st = _pdf_esc(str(ai.get("status") or "-"))
        sv_t = _pdf_esc(_saved_time(d.get("created_at")))
        if ai.get("fare") or ai.get("status"):
            av_ok = st.strip().upper().startswith(("AVAILABLE", "RAC"))
            av_col = "#16a34a" if av_ok else "#dc2626"
            info = (f"Fare: <font color='#16a34a'><b>Rs.{fare}</b></font>"
                    f" &nbsp;\u2022&nbsp; Availability: <font color='{av_col}'><b>{st}</b></font>"
                    f" &nbsp;\u2022&nbsp; Saved: <font color='#64748b'>{sv_t}</font>")
        else:
            info = (f"Fare / Availability: <font color='#64748b'>not saved</font>"
                    f" &nbsp;\u2022&nbsp; Saved: <font color='#64748b'>{sv_t}</font>")

        booked_meta = []
        bu = str(d.get("emp_name") or d.get("username") or "").strip()
        pm = str(d.get("pay_mode") or "").strip()
        pay = str(d.get("pay") or "").strip()
        if pm:
            booked_meta.append(f"Payment: <font color='#0f766e'><b>{_pdf_esc(pm)}</b></font>")
        if bu:
            booked_meta.append(f"Order Receiver: <font color='#1d4ed8'><b>{_pdf_esc(bu)}</b></font>")
        try:
            t_v = int(str(d.get("total") or "0").replace(",", ""))
            a_v = int(str(d.get("adv_amount") or "0").replace(",", ""))
            if pay == "Advanced":
                due_raw = str(max(t_v - a_v, 0))
            elif not pay:
                due_raw = str(t_v)
            else:
                due_raw = ""
        except Exception:
            a_v = 0
            t_v = 0
            due_raw = ""
        if t_v > 0:
            booked_meta.append(f"Total: <font color='#0f172a'><b>Rs.{_pdf_esc(str(t_v))}</b></font>")
        if pay == "Advanced" and a_v > 0:
            booked_meta.append(f"Advance: <font color='#7c3aed'><b>Rs.{_pdf_esc(str(a_v))}</b></font>")
        if due_raw:
            due_col = "#dc2626" if int(due_raw) > 0 else "#16a34a"
            booked_meta.append(f"Due: <font color='{due_col}'><b>Rs.{_pdf_esc(due_raw)}</b></font>")
        booked_line = " &nbsp;\u2022&nbsp; ".join(booked_meta)
        desc = str(d.get("desc") or "").strip()

        pax = d.get("passengers") or []
        pax_rows = [
            [Paragraph("NAME", paxHD), Paragraph("AGE", paxHD),
             Paragraph("GENDER", paxHD), Paragraph("BERTH", paxHD)]
        ]
        for p in pax[:6]:
            pax_rows.append([
                Paragraph(f"<b>{_pdf_esc(str(p.get('name') or '-'))}</b>", paxNM),
                Paragraph(_pdf_esc(str(p.get('age') or '-')), paxCE),
                Paragraph(_pdf_esc(str(p.get('gender') or '-')), paxCE),
                Paragraph(_pdf_esc(str(p.get('berth') or '-')), paxCE),
            ])
        while len(pax_rows) < 7:
            pax_rows.append(["", "", "", ""])
        pax_name_w = max(col_w - 18 - (22 + 26 + 30), 66)
        paxbox = Table(pax_rows,
                       colWidths=[pax_name_w, 22, 26, 30])
        paxbox.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.9, colors.HexColor("#1d4ed8")),
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f5f8ff")),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#dbeafe")),
            ("LINEBELOW", (0, 0), (-1, 0), 0.9, colors.HexColor("#1d4ed8")),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cbd5e1")),
            ("ROWHEIGHT", (1, 0), (-1, -1), 6.5),
            ("LEFTPADDING", (0, 0), (-1, -1), 2),
            ("RIGHTPADDING", (0, 0), (-1, -1), 2),
            ("TOPPADDING", (0, 0), (-1, -1), 1),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
        ]))
        paxbox.hAlign = "LEFT"

        tname = str(d.get("t_name") or "").strip() or "TICKET"
        star_pre = "<font color='#fbbf24'>&#9733; </font>" if d.get("starred") else ""
        star_ch = "\u2605 " if d.get("starred") else ""
        avail_w = col_w - 10
        name_avail = avail_w - _pdfmetrics.stringWidth(star_ch, _FONT_BOLD, 8.5) \
                     - _pdfmetrics.stringWidth(f"CARD-{num}  ", _FONT_BOLD, 8.5) \
                     - _pdfmetrics.stringWidth("...", _FONT_BOLD, 8.5)
        if _pdfmetrics.stringWidth(tname, _FONT_BOLD, 8.5) > name_avail:
            short = tname
            while short and len(short) > 1 and _pdfmetrics.stringWidth(short + "...", _FONT_BOLD, 8.5) > name_avail + \
                    _pdfmetrics.stringWidth("...", _FONT_BOLD, 8.5):
                short = short[:-1]
            tname = short.rstrip() + "..." if short else "..."

        hdr_st = ParagraphStyle("hF", fontName=_FONT_BOLD, fontSize=8.5, leading=10.5,
                                textColor=colors.white)
        hdr_line1 = Paragraph(f"{star_pre}CARD-{num}&nbsp;&nbsp;{_pdf_esc(tname)}", hdr_st)
        mob_style = ParagraphStyle("hM", fontName=_FONT_NORMAL, fontSize=7, leading=8.5,
                                   textColor=colors.HexColor("#f1f5f9"))
        hdr_line2 = Paragraph(f"mob: {_pdf_esc(mob)}", mob_style)
        hdrbox = Table([[hdr_line1], [hdr_line2]], colWidths=[col_w])
        hdrbox.setStyle(TableStyle([
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 1),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
        ]))
        hdrbox.hAlign = "LEFT"

        hd_bg = colors.HexColor("#b45309") if d.get("starred") else colors.HexColor("#1d4ed8")

        rows = [
            [hdrbox],
            [Paragraph(f"T.No.: {train} &nbsp;|&nbsp; Class: <font color='#7c3aed'><b>{cls}</b></font>"
                       f" &nbsp;\u00b7&nbsp; Quota: {quota}"
                       f" &nbsp;|&nbsp; Journey: <font color='#1d4ed8'><b>{jd}</b></font>", hB)],
            [paxbox],
        ]
        if info:
            rows.append([Paragraph(info, cS)])
        if booked_line:
            rows.append([Paragraph(booked_line, cS)])
        if desc:
            rows.append([Paragraph(f"Desc: <font color='#64748b'>{_pdf_esc(desc)}</font>", fS)])
        t = Table(rows, colWidths=[col_w])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#ffffff")),
            ("BACKGROUND", (0, 0), (-1, 0), hd_bg),
            ("LINEBELOW", (0, 0), (-1, 0), 1.4, colors.HexColor("#fbbf24")),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 2),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ]))
        t.hAlign = "LEFT"
        return t

    docs_sorted = sorted(docs, key=lambda d: (
        str(d.get("date") or "").strip(),
        str(d.get("src") or "").strip(),
        str(d.get("dst") or "").strip(),
        str(d.get("train") or "").strip(),
        str(d.get("quota") or "GN").strip(),
        str(d.get("cls") or "").strip(),
    ))

    buf = io.BytesIO()
    c = _canvas.Canvas(buf, pagesize=A4, title="Order Report", author="NXTGen PRS")
    n = len(docs_sorted)
    total_pages = max((n + grid_x * grid_y - 1) // (grid_x * grid_y), 1)

    probe = _canvas.Canvas(io.BytesIO(), pagesize=A4)

    def _draw_header(page_no):
        c.saveState()
        c.setFont(_FONT_BOLD, 9.5)
        c.setFillColor(colors.HexColor("#0f172a"))
        c.drawCentredString(page_w / 2.0, page_h - 4.5 * mm,
                            f"Order Report  {('|  ' + sub) if label else ''}")
        c.setFont(_FONT_NORMAL, 8.5)
        c.setFillColor(colors.HexColor("#1e40af"))
        c.drawRightString(page_w - right_m, page_h - 4.5 * mm,
                          f"Page {page_no} of {total_pages}")
        c.restoreState()

    def _draw_card(t, col, row, num):
        x = left_m + col * (col_w + gap)
        y_top = page_h - top_m - row * (card_h + gap)
        y_bot = y_top - card_h
        c.saveState()
        c.setFillColor(colors.HexColor("#ffffff"))
        c.setStrokeColor(colors.HexColor("#cbd5e1"))
        c.setLineWidth(1)
        c.rect(x, y_bot, col_w, card_h, stroke=1, fill=1)
        try:
            ch = t.wrap(col_w, 10 ** 9)[1]
        except Exception:
            ch = card_h
        if ch > card_h:
            f = card_h / ch
            c.translate(x, y_bot)
            c.scale(f, f)
            t.drawOn(c, 0, 0)
        else:
            t.drawOn(c, x, y_top - ch)
        c.restoreState()

    page_no = 1
    for start in range(0, n, grid_x * grid_y):
        page_docs = docs_sorted[start:start + grid_x * grid_y]
        _draw_header(page_no)
        for idx, doc in enumerate(page_docs):
            t = _card(doc, start + idx + 1)
            row_i, col_i = divmod(idx, grid_x)
            _draw_card(t, col_i, row_i, start + idx + 1)
        page_no += 1
        c.showPage()
    c.save()
    buf.seek(0)
    return buf


@app.route("/api/tickets/export", methods=["POST"])
@login_required
@csrf_protected
def api_export_orders_pdf(user):
    """Selected date ke saare orders ek hi PDF me (grouped) download karo."""
    data = request.get_json(silent=True) or {}
    ids = data.get("ids") or []
    label = (data.get("label") or "").strip()
    oids = []
    for i in ids:
        try:
            oids.append(ObjectId(str(i)))
        except (InvalidId, TypeError):
            pass
    if not oids:
        return _json_error("Koi order select nahi hua.", 400)
    try:
        docs = list(tickets_col.find({"_id": {"$in": oids}}).sort("created_at", 1))
    except PyMongoError:
        logger.exception("Could not load tickets for export")
        return _json_error("Orders load nahi ho sake.", 500)
    docs = [d for d in docs if str(d.get("user_id")) == str(user["_id"]) or user.get("role") == "admin"]
    if not docs:
        return _json_error("Ek bhi order nahi mila.", 404)
    try:
        buf = _build_orders_pdf(docs, label)
    except Exception:
        logger.exception("PDF generation failed")
        return _json_error("PDF ban nahi paayi.", 500)
    fname = f"Orders-{label.strip().replace(chr(92), '').replace('/', '-') or 'All'}.pdf"
    return send_file(buf, mimetype="application/pdf", download_name=fname, as_attachment=True, max_age=0)


# ---------------------------------------------------------------- Chat (login ke baad)
_CHAT_IMAGE_TYPES = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "gif": "image/gif",
    "webp": "image/webp",
}


def _serialize_chat_msg(doc):
    return {
        "id": str(doc["_id"]),
        "user_id": doc.get("user_id", ""),
        "username": doc.get("username", ""),
        "text": doc.get("text", ""),
        "image": bool(doc.get("image_key")),
        "image_id": str(doc["_id"]) if doc.get("image_key") else "",
        "img_url": f"/api/chat/images/{doc['_id']}" if doc.get("image_key") else "",
        "ts": doc.get("ts"),
    }


@app.route("/api/chat/messages", methods=["GET"])
@login_required
def api_chat_messages(user):
    since = (request.args.get("since") or "").strip()
    limit = min(int(request.args.get("limit") or 50), 100)
    filt = {}
    if since:
        try:
            filt["_id"] = {"$gt": ObjectId(since)}
        except (InvalidId, TypeError):
            filt = {}
    msgs = list(chat_col.find(filt).sort("_id", -1).limit(limit))
    msgs.reverse()
    return jsonify({
        "success": True,
        "me_id": str(user["_id"]),
        "me": user.get("username", ""),
        "messages": [_serialize_chat_msg(m) for m in msgs],
    })


@app.route("/api/chat/messages", methods=["POST"])
@login_required
@csrf_protected
def api_chat_send(user):
    data = request.get_json(silent=True) or request.form
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"success": False, "error": "Kuch likh ke bhejo."}), 400
    if len(text) > 2000:
        return jsonify({"success": False, "error": "Message 2000 characters se chhota hona chahiye."}), 400
    doc = {
        "user_id": str(user["_id"]),
        "username": user.get("username", ""),
        "text": text,
        "ts": datetime.now(timezone.utc),
    }
    try:
        result = chat_col.insert_one(doc)
    except PyMongoError:
        logger.exception("Could not save chat message")
        return jsonify({"success": False, "error": "Message bheja nahi ja saka."}), 500
    doc["_id"] = result.inserted_id
    return jsonify({"success": True, "message": "Bhej diya.", "msg": _serialize_chat_msg(doc)}), 201


@app.route("/api/chat/images", methods=["POST"])
@login_required
@csrf_protected
def api_chat_image(user):
    file = request.files.get("file")
    if file is None or not file.filename:
        return jsonify({"success": False, "error": "Image file chahiye."}), 400
    fname = (file.filename or "").lower()
    ext = fname.rsplit(".", 1)[-1] if "." in fname else ""
    ct = _CHAT_IMAGE_TYPES.get(ext)
    if ct is None:
        return jsonify({"success": False, "error": "Sirf PNG, JPG, GIF, WEBP bhej sakte ho."}), 400
    data = file.read()
    if not data:
        return jsonify({"success": False, "error": "Image khali hai."}), 400
    if len(data) > 5 * 1024 * 1024:
        return jsonify({"success": False, "error": "Image 5MB se bada hai."}), 400
    doc = {
        "user_id": str(user["_id"]),
        "username": user.get("username", ""),
        "text": "",
        "image_key": None,
        "image_ct": ct,
        "ts": datetime.now(timezone.utc),
    }
    try:
        result = chat_col.insert_one(doc)
        key = f"chat/{result.inserted_id}{('.' + ext) if ext else ''}"
        b2.upload_bytes(data, key, ct)
        chat_col.update_one({"_id": result.inserted_id}, {"$set": {"image_key": key}})
    except B2Error as exc:
        logger.error("Could not upload chat image: %s", exc)
        return jsonify({"success": False, "error": "Image upload nahi hui."}), exc.status_code
    except PyMongoError:
        logger.exception("Could not save chat image")
        return jsonify({"success": False, "error": "Image save nahi ho saki."}), 500
    doc["_id"] = result.inserted_id
    doc["image_key"] = key
    return jsonify({"success": True, "message": "Image bhej di.", "msg": _serialize_chat_msg(doc)}), 201


@app.route("/api/chat/images/<message_id>", methods=["GET"])
@login_required
def api_chat_image_get(user, message_id):
    try:
        oid = ObjectId(message_id)
    except (InvalidId, TypeError):
        return _json_error("Invalid image id.", 400)
    doc = chat_col.find_one({"_id": oid})
    if doc is None or not doc.get("image_key"):
        return _json_error("Image nahi mili.", 404)
    try:
        data = b2.get_object_bytes(doc["image_key"])
    except B2Error as exc:
        logger.error("Could not fetch chat image %s: %s", doc["image_key"], exc)
        return _json_error(exc.message, exc.status_code)
    return send_file(io.BytesIO(data), mimetype=doc.get("image_ct", "image/jpeg"),
                     download_name="chat_image", max_age=3600)


# ---------------------------------------------------------------- Voice group call (WebRTC mesh via polling signals)
def _sig_ser(s):
    return {
        "id": str(s["_id"]),
        "from": s.get("from", ""),
        "to": s.get("to", "*"),
        "kind": s.get("kind", ""),
        "payload": s.get("payload", {}),
    }


def _enqueue_call_signal(from_id, to_id, kind, payload):
    doc = {
        "room": _CALL_ROOM,
        "from": from_id,
        "to": to_id or "*",
        "kind": kind,
        "payload": payload,
        "ts": time.time(),
    }
    try:
        call_signals_col.insert_one(doc)
        if call_signals_col.count_documents({"room": _CALL_ROOM}) > 1000:
            to_drop = list(call_signals_col.find({"room": _CALL_ROOM}).sort("_id", 1).limit(400))
            if to_drop:
                call_signals_col.delete_many({"_id": {"$in": [d["_id"] for d in to_drop]}})
    except PyMongoError:
        logger.exception("Could not store call signal")


def _prune_call_members():
    """Stale members (tub > 40s) hatao + sabko 'left' signal bhejo. Returns live members."""
    now = time.time()
    stale = list(call_members_col.find({"room": _CALL_ROOM, "last_seen": {"$lt": now - _CALL_TIMEOUT_SECONDS}}))
    for m in stale:
        call_members_col.delete_one({"_id": m["_id"]})
        _enqueue_call_signal(m["user_id"], "*", "left", {"user_id": m["user_id"], "username": m.get("username", "")})
    return list(call_members_col.find({"room": _CALL_ROOM}))


@app.route("/api/call/join", methods=["POST"])
@login_required
@csrf_protected
def api_call_join(user):
    uid = str(user["_id"])
    uname = user.get("username", "")
    now = time.time()
    try:
        call_members_col.update_one(
            {"user_id": uid, "room": _CALL_ROOM},
            {"$set": {"username": uname, "last_seen": now}},
            upsert=True,
        )
    except PyMongoError:
        logger.exception("Could not join call")
        return _json_error("Call join nahi ho saka.", 500)

    members = _prune_call_members()
    others = [{"user_id": m["user_id"], "username": m.get("username", "")} for m in members if m["user_id"] != uid]
    recent = list(call_signals_col.find({"room": _CALL_ROOM}).sort("_id", -1).limit(30))
    recent.reverse()
    return jsonify({
        "success": True,
        "me": {"user_id": uid, "username": uname},
        "participants": others,
        "signals": [_sig_ser(s) for s in recent],
        "since": str(recent[-1]["_id"]) if recent else "",
    })


@app.route("/api/call/state", methods=["GET"])
@login_required
def api_call_state(user):
    uid = str(user["_id"])
    since = (request.args.get("since") or "").strip()
    now = time.time()
    try:
        call_members_col.update_one(
            {"user_id": uid, "room": _CALL_ROOM},
            {"$set": {"username": user.get("username", ""), "last_seen": now}},
            upsert=True,
        )
    except PyMongoError:
        logger.exception("Could not touch call member")
        return _json_error("Call state update nahi hua.", 500)

    members = _prune_call_members()
    others = [{"user_id": m["user_id"], "username": m.get("username", "")} for m in members if m["user_id"] != uid]

    filt = {"room": _CALL_ROOM}
    if since:
        try:
            filt["_id"] = {"$gt": ObjectId(since)}
        except (InvalidId, TypeError):
            filt = {"room": _CALL_ROOM}

    rows = list(call_signals_col.find(filt).sort("_id", -1).limit(100))
    rows.reverse()
    last_id = ""
    if rows:
        last_id = str(rows[-1]["_id"])
    elif since:
        last_id = since
    # garantee monotonic since: newest existing marker
    if not last_id:
        newest = call_signals_col.find_one({"room": _CALL_ROOM}, sort=[("_id", -1)])
        if newest:
            last_id = str(newest["_id"])

    return jsonify({
        "success": True,
        "participants": others,
        "signals": [_sig_ser(s) for s in rows],
        "since": last_id,
    })


@app.route("/api/call/signal", methods=["POST"])
@login_required
@csrf_protected
def api_call_signal(user):
    data = request.get_json(silent=True) or request.form
    to_uid = (data.get("to") or "*").strip()
    kind = (data.get("kind") or "").strip()
    payload = data.get("payload") or {}
    if kind not in ("offer", "answer", "ice", "left"):
        return _json_error("Signal type galat hai.", 400)
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except (TypeError, ValueError):
            payload = {"value": payload}
    _enqueue_call_signal(str(user["_id"]), to_uid, kind, payload)
    return jsonify({"success": True, "message": "Signal bhej diya."})


@app.route("/api/call/leave", methods=["POST"])
@login_required
@csrf_protected
def api_call_leave(user):
    uid = str(user["_id"])
    doc = call_members_col.find_one_and_delete({"user_id": uid, "room": _CALL_ROOM})
    _enqueue_call_signal(uid, "*", "left", {"user_id": uid, "username": user.get("username", "")})
    return jsonify({"success": True, "message": "Call chhoda."})


@app.route("/api/fresh-ids", methods=["GET"])
@login_required
def api_list_fresh_ids(user):
    docs = fresh_ids_col.find({}).sort("created_at", -1)
    return jsonify({"success": True, "fresh_ids": [_serialize_fresh_id(d) for d in docs]})


@app.route("/api/fresh-ids", methods=["POST"])
@login_required
@csrf_protected
def api_add_fresh_id(user):
    data = request.get_json(silent=True) or request.form
    uid_val = (data.get("user_id_value") or "").strip()
    password = (data.get("password") or "").strip()
    owner = (data.get("owner") or "").strip()
    if not uid_val or not password:
        return jsonify({"success": False, "error": "User ID aur Password dono daalein."}), 400
    default_owner = (user.get("emp") or {}).get("full_name") or user.get("username", "")
    doc = {
        "user_id_value": uid_val,
        "password": password,
        "owner": owner or default_owner,
        "created_by": str(user["_id"]),
        "created_at": datetime.now(timezone.utc),
    }
    try:
        result = fresh_ids_col.insert_one(doc)
    except PyMongoError:
        logger.exception("Could not save fresh id")
        return jsonify({"success": False, "error": "ID save nahi ho payi."}), 500
    doc["_id"] = result.inserted_id
    return jsonify({"success": True, "message": "ID add ho gayi.", "fresh_id": _serialize_fresh_id(doc)}), 201


@app.route("/api/fresh-ids/<fresh_id>", methods=["DELETE"])
@login_required
@csrf_protected
def api_delete_fresh_id(user, fresh_id):
    try:
        oid = ObjectId(fresh_id)
    except (InvalidId, TypeError):
        return jsonify({"success": False, "error": "Invalid id."}), 400
    doc = fresh_ids_col.find_one({"_id": oid})
    if doc is None:
        return jsonify({"success": False, "error": "ID not found."}), 404
    if doc.get("created_by") != str(user["_id"]) and user.get("role") != "admin":
        return jsonify({"success": False, "error": "Is ID ko delete karne ki permission nahi hai."}), 403
    try:
        fresh_ids_col.delete_one({"_id": oid})
    except PyMongoError:
        logger.exception("Could not delete fresh id")
        return jsonify({"success": False, "error": "ID delete nahi ho payi."}), 500
    return jsonify({"success": True, "message": "ID deleted."})


@app.route("/api/fresh-ids/bulk", methods=["POST"])
@login_required
@csrf_protected
def api_bulk_add_fresh_ids(user):
    data = request.get_json(silent=True) or request.form
    raw_ids = (data.get("ids") or "")
    password = (data.get("password") or "").strip()
    owner = (data.get("owner") or "").strip()
    id_list = [x.strip() for x in raw_ids.replace(",", "\n").splitlines() if x.strip()]
    if not id_list or not password:
        return jsonify({"success": False, "error": "Kam se kam ek User ID aur common Password daalein."}), 400
    default_owner = (user.get("emp") or {}).get("full_name") or user.get("username", "")
    owner_val = owner or default_owner
    created = []
    for uid_val in id_list:
        if fresh_ids_col.find_one({"user_id_value": uid_val}):
            continue
        doc = {
            "user_id_value": uid_val,
            "password": password,
            "owner": owner_val,
            "created_by": str(user["_id"]),
            "created_at": datetime.now(timezone.utc),
        }
        try:
            result = fresh_ids_col.insert_one(doc)
        except PyMongoError:
            logger.exception("Could not save bulk fresh id")
            continue
        doc["_id"] = result.inserted_id
        created.append(_serialize_fresh_id(doc))
    return jsonify({
        "success": True,
        "message": f"{len(created)} ID(s) add ho gayi.",
        "fresh_ids": created,
    }), 201 if created else 200


@app.route("/notepad")
def notepad_page():
    return render_template("notepad.html")


@app.route("/bulk-id")
def bulk_id_page():
    return render_template("bulk_id.html")


@app.route("/dashboard")
@login_required
def dashboard(user):
    return render_template("dashboard.html", user=user)


@app.route("/api/notepad", methods=["GET"])
def api_get_notepad():
    user = get_current_user()
    if user is None:
        return jsonify({"success": False, "error": "login-required"}), 401
    doc = notepad_col.find_one({"user_id": str(user["_id"])})
    return jsonify({
        "success": True,
        "content": (doc or {}).get("content", ""),
        "updated_at": (doc or {}).get("updated_at"),
    })


@app.route("/api/notepad", methods=["POST"])
@csrf_protected
def api_save_notepad():
    data = request.get_json(silent=True) or request.form
    content = data.get("content") or ""
    user = get_current_user()
    if user is not None:
        filter_q = {"user_id": str(user["_id"])}
    else:
        device = (data.get("device") or "").strip()
        if not device or len(device) > 64:
            return jsonify({"success": False, "error": "Device id missing."}), 400
        filter_q = {"_id": device}
    try:
        notepad_col.update_one(
            filter_q,
            {"$set": {"content": content, "updated_at": datetime.now(timezone.utc)}},
            upsert=True,
        )
    except PyMongoError:
        logger.exception("Could not save notepad")
        return jsonify({"success": False, "error": "Notepad save nahi hua."}), 500
    return jsonify({"success": True, "message": "Saved."})


# ---------------------------------------------------------------- CLI command
@app.cli.command("create-admin")
@click.argument("username")
@click.argument("password")
@click.option("--email", default="", help="Optional email for the admin account.")
def create_admin_command(username, password, email):
    """Create an admin user from the terminal, e.g.:
    flask --app app create-admin prakashadmin StrongPass123 --email admin@prakashtravel.com
    """
    if len(password) < 4:
        click.echo("Error: password must be at least 4 characters.")
        raise SystemExit(1)
    if users_col.find_one({"username": username}):
        click.echo("Error: username already exists.")
        raise SystemExit(1)
    users_col.insert_one(
        {
            "username": username,
            "email": (email or f"{username}@prakashtravel.local").lower(),
            "password_hash": generate_password_hash(password),
            "role": "admin",
            "created_at": datetime.now(timezone.utc),
        }
    )
    click.echo(f"Admin user '{username}' created.")


# ---------------------------------------------------------------- Error handlers
def _render_error(status, message, details=""):
    if request.path.startswith("/admin/api"):
        return jsonify({"success": False, "error": message, "details": details}), status
    return render_template("error.html", status=status, message=message, app_name=Config.APP_NAME), status


@app.errorhandler(403)
def forbidden_handler(exc):
    return _render_error(403, "Access denied. You must be an admin to open this page.")


@app.errorhandler(404)
def not_found_handler(exc):
    return _render_error(404, "Page not found.")


@app.errorhandler(413)
def too_large_handler(exc):
    return _render_error(
        413,
        f"File too large. Maximum allowed size is {Config.MAX_PDF_SIZE_MB} MB.",
    )


@app.errorhandler(500)
def server_error_handler(exc):
    logger.exception("Unhandled server error")
    return _render_error(500, "Something went wrong on the server. Please try again.")


@app.errorhandler(RequestEntityTooLarge)
def entity_too_large_handler(exc):
    return _render_error(
        413,
        f"File too large. Maximum allowed size is {Config.MAX_PDF_SIZE_MB} MB.",
    )


# ---------------------------------------------------------------- Security headers
@app.after_request
def add_security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    return response


# ---------------------------------------------------------------- Entry point
if __name__ == "__main__":
    _prime_mongo()
    port = int(os.environ.get("PORT", "5000"))
    debug = os.environ.get("FLASK_DEBUG", "false").strip().lower() in ("1", "true", "yes", "on")
    app.run(host="0.0.0.0", port=port, debug=debug, threaded=True)