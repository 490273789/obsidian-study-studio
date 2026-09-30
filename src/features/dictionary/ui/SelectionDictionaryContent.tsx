import React from "react";
import type { SelectionEmbeddedContentProps } from "../../../core/selectionHelper/ui/types";
import type { SandboxDocument } from "../domain/sandbox-document";
import { SandboxDocumentFrame } from "./SandboxDocumentFrame";

/** Feature-owned rendering of the opaque document supplied by the dictionary adapter. */
export const SelectionDictionaryContent = React.memo(function SelectionDictionaryContent({
	handle,
	...props
}: SelectionEmbeddedContentProps) {
	return <SandboxDocumentFrame document={handle as SandboxDocument} {...props} />;
});
