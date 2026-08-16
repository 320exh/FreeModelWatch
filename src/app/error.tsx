"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col gap-4 items-start">
      <h1 className="text-2xl font-bold tracking-tight">Something went wrong</h1>
      <p className="text-[var(--fg-dim)] text-[14px] max-w-xl">
        This page hit an unexpected error. The data layer may be unavailable or a query failed. Try again, or head back to the dashboard.
      </p>
      <p className="text-[12px] text-[var(--fg-mute)] font-mono break-all">{error.message}</p>
      <div className="flex gap-3">
        <button className="btn btn-primary" onClick={() => reset()}>Try again</button>
        <Link href="/" className="btn">Home</Link>
      </div>
    </div>
  );
}
