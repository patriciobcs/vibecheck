"use client";

import { ParticipantDialog } from "@/components/participant/dialog";

export function HostedDialog(props: {
  assignmentId: string;
  productUrl: string;
  permittedOrigins: string[];
  providersReady: boolean;
}) {
  return (
    <ParticipantDialog
      assignmentId={props.assignmentId}
      token={null}
      host={{
        kind: "page",
        productUrl: props.productUrl,
        permittedOrigins: props.permittedOrigins,
      }}
      providersReady={props.providersReady}
    />
  );
}
