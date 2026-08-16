import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col gap-4 items-start">
      <h1 className="text-2xl font-bold tracking-tight">Not found</h1>
      <p className="text-[var(--fg-dim)] text-[14px]">
        We couldn&apos;t find that model, provider, or harness. It may have been removed, renamed, or never existed.
      </p>
      <div className="flex gap-3">
        <Link href="/models" className="btn btn-primary">Browse models</Link>
        <Link href="/" className="btn">Home</Link>
      </div>
    </div>
  );
}
