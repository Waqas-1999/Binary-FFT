import { Container, Skeleton } from "@repo/ui";

export default function PublicLoading() {
  return (
    <Container aria-busy="true" aria-label="Loading" className="flex max-w-3xl flex-col gap-4">
      <Skeleton className="h-9 w-56 max-w-full" />
      <Skeleton className="h-5 w-80 max-w-full" />
      <Skeleton className="mt-4 h-40 w-full rounded-lg" />
    </Container>
  );
}
