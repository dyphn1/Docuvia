import multer, { type FileFilterCallback } from "multer";
import type { Request } from "express";

const ALLOWED_MIMETYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/markdown",
  "application/octet-stream",
]);

const ALLOWED_EXTENSIONS = new Set(["pdf", "docx", "pptx", "txt", "md", "map", "fv", "fd", "log"]);

export const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const ext = file.originalname.split(".").pop()?.toLowerCase() ?? "";
    if (ALLOWED_MIMETYPES.has(file.mimetype) || ALLOWED_EXTENSIONS.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype} (.${ext})`));
    }
  },
});
