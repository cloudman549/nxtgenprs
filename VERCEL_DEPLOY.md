# Vercel Deployment Instructions

## Steps to Deploy:

### 1. Install Vercel CLI (agar installed nahi hai):
```bash
npm install -g vercel
```

### 2. Vercel Dashboard mein Environment Variables set karo:
Go to: https://vercel.com/your-username/nxtgenprs/settings/environment-variables

Add these variables:
```
MONGO_URI=mongodb+srv://prajapatipoojaram650_db_user:1ELuTU03kL9J5KwN@prajapatipooja.ck5xuvs.mongodb.net/?appName=prajapatipooja
MONGO_DB_NAME=prakash_travel
SECRET_KEY=8607CB82DB8AAEAD71E958B706B0A7C05DDBEF65F806049913A3F496104BC7D23D590CAF36F282D4846AB6079436D1E8
B2_KEY_ID=0056f820e66c5a30000000001
B2_APPLICATION_KEY=K0058nTtVvng8/Na2BS6aPRTKO1GilA
B2_BUCKET_NAME=my-pdf-storage-2026
B2_ENDPOINT=https://s3.us-east-005.backblazeb2.com
B2_REGION=us-east-005
SESSION_COOKIE_SECURE=true
MAX_PDF_SIZE_MB=50
PRESIGNED_URL_EXPIRY=900
PUBLIC_LIST_CACHE_SECONDS=30
PDF_RETENTION_DAYS=100
PURGE_INTERVAL_SECONDS=900
```

### 3. Deploy command:
```bash
vercel --prod
```

## Important Files:
- `api/index.py` - Vercel entry point
- `vercel.json` - Vercel configuration
- `requirements.txt` - Python dependencies
- `.vercelignore` - Files to exclude from deployment

## Testing:
After deployment, test these endpoints:
- https://nxtgenprs.vercel.app/ (Homepage)
- https://nxtgenprs.vercel.app/healthz (Health check)
- https://nxtgenprs.vercel.app/admin-login (Admin login)

## Login Credentials:
- Username: PK96
- Password: PAS
