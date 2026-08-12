export interface UploadedFile {
  fileId: string;
  name: string;
  storagePath: string;
  type: 'tm' | 'replacement';
  size: number;
  contentType: string;
  uploadedAt: string;
  uploadedBy: string;
}
