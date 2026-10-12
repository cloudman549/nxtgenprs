#!/bin/bash
# Vercel build script to install Tesseract OCR

echo "Installing Tesseract OCR..."
apt-get update
apt-get install -y tesseract-ocr

echo "Tesseract installed:"
tesseract --version

echo "Build complete!"
