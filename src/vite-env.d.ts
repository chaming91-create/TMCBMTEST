/// <reference types="vite/client" />

declare module "*.xlsx?base64" { const data: string; export default data; }
