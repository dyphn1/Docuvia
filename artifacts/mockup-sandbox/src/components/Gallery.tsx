import { GALLERY_MESSAGES } from "../constants/preview-messages";
import { getPreviewExamplePath } from "../lib/preview-utils";

export function Gallery() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
      <div className="text-center max-w-md">
        <h1 className="text-2xl font-semibold text-gray-900 mb-3">{GALLERY_MESSAGES.TITLE}</h1>
        <p className="text-gray-500 mb-4">{GALLERY_MESSAGES.DESCRIPTION}</p>
        <p className="text-sm text-gray-400">
          {GALLERY_MESSAGES.ACCESS_HINT}{" "}
          <code className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">
            {getPreviewExamplePath()}
          </code>
        </p>
      </div>
    </div>
  );
}
