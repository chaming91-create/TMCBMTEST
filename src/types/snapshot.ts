import type { AppData } from '../lib/firestoreService';
export interface DataSnapshot extends AppData { snapshotId:string; name:string; createdAt:string; tmCount:number; historyCount:number; }
