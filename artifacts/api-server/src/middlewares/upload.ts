import multer, { type FileFilterCallback } from "multer";
import type { Request } from "express";

import os from "node:os";
import {
  MAX_UPLOAD_FILE_SIZE_BYTES,
  ALLOWED_DOCUMENT_MIMETYPES,
  ALLOWED_DOCUMENT_EXTENSIONS,
} from "@workspace/core";
import { API_MESSAGES } from "@workspace/core";

export const documentUpload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: MAX_UPLOAD_FILE_SIZE_BYTES },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const ext = file.originalname.split(".").pop()?.toLowerCase() ?? "";
    if (ALLOWED_DOCUMENT_MIMETYPES.has(file.mimetype) || ALLOWED_DOCUMENT_EXTENSIONS.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error(API_MESSAGES.UNSUPPORTED_FILE_TYPE(file.mimetype, ext)));
    }
  },
});
