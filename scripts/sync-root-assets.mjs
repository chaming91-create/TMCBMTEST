import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('assets', { recursive: true, force: true });
mkdirSync('assets', { recursive: true });
cpSync('dist/assets', 'assets', { recursive: true });
