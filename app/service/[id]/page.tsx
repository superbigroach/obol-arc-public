// Server component — exports generateStaticParams so Next.js static export
// pre-renders a shell HTML. Firebase rewrites /service/** to this shell;
// the client component reads the real id from the URL on hydration.
import ServicePage from "./_client";

export function generateStaticParams() {
  return [{ id: "_" }];
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ServicePage params={params} />;
}
