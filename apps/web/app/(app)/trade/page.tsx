import { Badge, Card, Container, Input, PageHeader } from "@repo/ui";
import { ArrowDown, ArrowUp, ChartSpline, ChevronDown, Eye } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Trade" };

const directionClasses =
  "flex min-h-14 cursor-not-allowed items-center justify-center gap-2 rounded-md border text-body font-semibold opacity-70";

/**
 * Layout preview only: asset → chart → time → amount → Up/Down.
 * No prices, chart data, payouts or execution exist yet; every value is a neutral placeholder.
 */
export default function TradePage() {
  return (
    <Container className="flex flex-col gap-6">
      <PageHeader
        title="Trade"
        description="Trading opens in a future update. This preview shows how the screen will be organized."
        action={
          <Badge tone="brand" icon={<Eye />}>
            Preview
          </Badge>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card padded={false} className="flex flex-col">
          <div className="flex min-h-16 items-center justify-between gap-3 border-b border-border px-4 sm:px-6">
            <div className="flex flex-col">
              <span className="text-caption text-text-secondary">Asset</span>
              <span className="text-h3 text-text-secondary">Not selected</span>
            </div>
            <ChevronDown aria-hidden="true" className="size-5 text-text-muted" />
          </div>
          <div
            role="img"
            aria-label="Chart area placeholder"
            className="m-4 flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border-strong text-text-muted sm:m-6 sm:aspect-video lg:aspect-auto lg:min-h-96 lg:flex-1"
          >
            <ChartSpline aria-hidden="true" className="size-8" strokeWidth={1.5} />
            <span className="text-body-small">Chart area</span>
          </div>
        </Card>

        <Card className="flex flex-col gap-5 lg:self-start">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
            <Input label="Time" placeholder="—" disabled hint="Available soon" />
            <Input label="Amount" placeholder="—" disabled inputMode="decimal" hint="Available soon" />
          </div>

          <div className="grid grid-cols-2 gap-3" aria-label="Trade direction (not available yet)" role="group">
            <button type="button" disabled className={`${directionClasses} border-up/30 bg-up/12 text-up-text`}>
              <ArrowUp aria-hidden="true" className="size-5" />
              Up
            </button>
            <button type="button" disabled className={`${directionClasses} border-down/30 bg-down/12 text-down-text`}>
              <ArrowDown aria-hidden="true" className="size-5" />
              Down
            </button>
          </div>
        </Card>
      </div>
    </Container>
  );
}
