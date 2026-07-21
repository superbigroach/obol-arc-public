// Server component — exports generateStaticParams so Next.js static export
// pre-renders a shell HTML. Firebase rewrites /seller/** to this shell;
// the client component reads the real uid from the URL on hydration.
import SellerPage from "./_client";

export function generateStaticParams() {
  return [{ uid: "_" }];
}

export default function Page({ params }: { params: Promise<{ uid: string }> }) {
  return <SellerPage params={params} />;
}
