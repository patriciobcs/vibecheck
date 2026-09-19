import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { tenantFromEnvironment } from "@/lib/auth";

export default async function Home() {
  const tenantId = await tenantFromEnvironment();
  const products = tenantId ? await prisma.product.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } }) : [];
  return <main><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><h1>Products</h1><Link href="/products/new"><button>New product</button></Link></div>
    <div className="grid">{products.map((product) => <Link className="card" href={`/products/${product.id}`} key={product.id}><h2>{product.name}</h2><p className="muted">{product.url}</p><p>Status: {product.status}</p></Link>)}</div>
    {products.length === 0 && <p className="muted"><Link href="/products/new">Connect a product</Link> to run discovery.</p>}
  </main>;
}
