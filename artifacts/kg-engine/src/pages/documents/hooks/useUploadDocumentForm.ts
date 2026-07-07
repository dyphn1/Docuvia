import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useIngestDocument,
  useUploadDocument,
  getListDocumentsQueryKey,
  getListMiscDocumentsQueryKey,
} from "@workspace/api-client-react";

export function useUploadDocumentForm() {
  const queryClient = useQueryClient();
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [filename, setFilename] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ingestMutation = useIngestDocument();
  const uploadMutation = useUploadDocument();

  const handleIngest = async () => {
    if (!filename.trim() || !content.trim()) return;
    setLoading(true);
    setError(null);
    setSuccess(false);

    const onFinish = () => {
      setSuccess(true);
      setFilename("");
      setContent("");
      setLoading(false);
    };

    const onError = (e: Error) => {
      setError(e.message || "Unknown error");
      setLoading(false);
    };

    if (selectedProject) {
      ingestMutation.mutate(
        {
          id: Number(selectedProject),
          data: { filename: filename.trim(), content: content.trim() },
        },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({
              queryKey: getListDocumentsQueryKey(Number(selectedProject)),
            });
            onFinish();
          },
          onError,
        }
      );
    } else {
      const file = new window.File([content.trim()], filename.trim(), { type: "text/plain" });
      uploadMutation.mutate(
        { data: { file } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListMiscDocumentsQueryKey() });
            onFinish();
          },
          onError,
        }
      );
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => setContent((ev.target?.result as string) ?? "");
    reader.readAsText(file);
  };

  return {
    selectedProject,
    setSelectedProject,
    filename,
    setFilename,
    content,
    setContent,
    loading,
    success,
    error,
    handleIngest,
    handleFileUpload,
  };
}
