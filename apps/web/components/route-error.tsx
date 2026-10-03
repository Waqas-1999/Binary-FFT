"use client";

import { Button, Container, ErrorState, useOnlineStatus } from "@repo/ui";
import { RotateCw } from "lucide-react";
import { useEffect } from "react";

/** Shared body for route error boundaries: friendly message for users, full error in the console for developers. */
export function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const online = useOnlineStatus();

  return (
    <Container>
      <ErrorState
        kind={online ? "generic" : "network"}
        action={
          <Button variant="secondary" icon={<RotateCw />} onClick={retry}>
            Try again
          </Button>
        }
      />
    </Container>
  );
}
