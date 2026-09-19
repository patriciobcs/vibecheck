import Script from "next/script";
import { SampleBadge } from "@/components/layout/shell";
import { db } from "@/db/client";

export const dynamic = "force-dynamic";

/**
 * SAMPLE TARGET. A tiny instrumented booking page so the embedded channel can be exercised locally.
 * It is not the VC-07 demo app; it exists to prove the SDK handshake and safe event capture.
 */
export default async function DemoTarget() {
  const product = await db.query.products.findFirst();
  return (
    <div className="min-h-screen bg-[#f5f5f7] text-[#1d1d1f]">
      {product ? (
        <Script
          src="/sdk/vibecheck.js"
          data-key={product.publishableKey}
          strategy="afterInteractive"
        />
      ) : null}
      <div className="mx-auto max-w-2xl px-6 py-14">
        <div className="mb-8 flex items-center justify-between">
          <p className="text-sm font-semibold">Sample Salon</p>
          <SampleBadge />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Your appointments</h1>
        <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
          <p className="text-sm text-[#6e6e73]">Upcoming</p>
          <p className="mt-1 text-lg font-medium">Haircut · September 22, 3:00 p.m.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="view-details"
              className="rounded-full bg-[#1d1d1f] px-4 py-2 text-sm font-medium text-white"
            >
              View details
            </button>
            <button
              type="button"
              data-testid="cancel"
              className="rounded-full border border-black/10 px-4 py-2 text-sm font-medium"
            >
              Cancel appointment
            </button>
          </div>
        </div>
        <form className="mt-6 rounded-2xl bg-white p-6 shadow-sm" onSubmit={undefined}>
          <p className="text-sm font-medium">Notes for your stylist</p>
          <input
            name="notes"
            placeholder="Typed text is never captured, only edit counts"
            className="mt-3 w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
          />
          <input
            name="password"
            type="password"
            placeholder="Password field (never captured)"
            className="mt-3 w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
          />
        </form>
        <p className="mt-8 text-xs text-[#6e6e73]">
          This page loads the VibeCheck SDK. Opened from the recorder, it streams safe events;
          opened directly, it may show an invitation toast.
        </p>
      </div>
    </div>
  );
}
