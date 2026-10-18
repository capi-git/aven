import { useEffect, useState } from "react";
import { imageMimeFor } from "../lib/filePreview";
import { readBinaryFile } from "../lib/fs";

export type ImageFileState =
  | { status: "loading" }
  | { status: "ready"; url: string; mime: string; size: number }
  | { status: "unsupported"; size: number }
  | { status: "error"; message: string };

const LOADING: ImageFileState = { status: "loading" };

/**
 * Read an image file into a blob URL that lives as long as the caller shows
 * it. The blob's MIME comes from the bytes, never the extension, so a file
 * named `.png` that holds markup can't become a same-origin document.
 * Changing `reloadKey` reads the file again.
 */
export function useImageFile(
  path: string | undefined,
  reloadKey = 0,
): ImageFileState {
  const [loaded, setLoaded] = useState<{
    path?: string;
    state: ImageFileState;
  }>({ state: LOADING });

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    let created: string | null = null;
    const setState = (state: ImageFileState) => setLoaded({ path, state });
    setState(LOADING);

    readBinaryFile(path).then(
      (bytes) => {
        if (cancelled) return;
        const mime = imageMimeFor(path, bytes);
        if (!mime) {
          setState({ status: "unsupported", size: bytes.byteLength });
          return;
        }
        created = URL.createObjectURL(new Blob([bytes], { type: mime }));
        setState({
          status: "ready",
          url: created,
          mime,
          size: bytes.byteLength,
        });
      },
      (cause: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: cause instanceof Error ? cause.message : String(cause),
        });
      },
    );

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [path, reloadKey]);

  // Until the new file is read, never show the previous file's picture.
  return loaded.path === path ? loaded.state : LOADING;
}
