#!/bin/bash
set -e

echo "===== Installing Tesseract OCR ====="
yum install -y tesseract || apt-get update && apt-get install -y tesseract-ocr

echo "===== Tesseract Version ====="
tesseract --version

echo "===== Build Complete ====="
