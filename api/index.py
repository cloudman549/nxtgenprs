"""Vercel serverless entry point.

Vercel imports this file's WSGI callable (`application`). All environment
variables (MONGO_URI, B2_*, SECRET_KEY, ...) must be set in the Vercel
dashboard, NOT in .env (Vercel ignores local .env files).
"""

from app import app as application

# Optional for A/B + warm start on some setups:
_ = application