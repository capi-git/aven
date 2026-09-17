import { useEffect, useState } from "react";
import { BrowserPane, type BrowserPaneProps } from "./BrowserPane";

/** Restore saved tabs lazily; transferred native pages must acknowledge attachment even when hidden. */
export function RetainedBrowserPane(props: BrowserPaneProps) {
  const [visited, setVisited] = useState(
    props.visible === true ||
      props.agentRequested === true ||
      !!props.attachedNativeId,
  );
  useEffect(() => {
    if (
      props.visible ||
      props.agentRequested ||
      props.pictureInPictureRequest ||
      props.attachedNativeId
    )
      setVisited(true);
  }, [
    props.visible,
    props.agentRequested,
    props.pictureInPictureRequest,
    props.attachedNativeId,
  ]);
  return visited ||
    props.visible ||
    props.agentRequested ||
    props.pictureInPictureRequest ||
    props.attachedNativeId ? (
    <BrowserPane {...props} />
  ) : null;
}
