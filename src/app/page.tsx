import Link from "next/link";
import { prisma } from "@/lib/prisma";

export default async function Home() {
  const products = await prisma.product.findMany({ orderBy: { createdAt: "desc" } });
  return <main><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><h1>Products</h1><Link href="/products/new"><button>New product</button></Link></div>
    <div className="grid">{products.map((product) => <Link className="card" href={`/products/${product.id}`} key={product.id}><h2>{product.name}</h2><p className="muted">{product.url}</p><p>Status: {product.status}</p></Link>)}</div>
    {products.length === 0 && <p className="muted">Connect a product to run discovery.</p>}
  </main>;
}
