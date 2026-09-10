import { cpSync, mkdirSync } from 'node:fs';

// Keep existing workbook assets and user files; only replace matching build outputs.
mkdirSync('assets', { recursive: true });
cpSync('dist/assets', 'assets', { recursive: true });
