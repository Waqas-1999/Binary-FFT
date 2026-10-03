import { Container, Skeleton } from "@repo/ui";

export default function AppLoading() {
  return (
    <Container aria-busy="true" aria-label="Loading" className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-5 w-64 max-w-full" />
      </div>
      <Skeleton className="h-64 w-full rounded-lg" />
    </Container>
  );
}
