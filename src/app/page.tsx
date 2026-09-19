import Link from "next/link";
import { tenantFromEnvironment } from "@/lib/auth";
import { db } from "@/db";
import { product } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

export default async function Home() {
  const tenantId = await tenantFromEnvironment();
  const products = tenantId
    ? await db
        .select()
        .from(product)
        .where(eq(product.tenantId, tenantId))
        .orderBy(desc(product.createdAt))
    : [];
  return (
    <main>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Products</h1>
        <Link href="/products/new">
          <button>New product</button>
        </Link>
      </div>
      <div className="grid">
        {products.map((product) => (
          <Link className="card" href={`/products/${product.id}`} key={product.id}>
            <h2>{product.name}</h2>
            <p className="muted">{product.url}</p>
            <p>Status: {product.status}</p>
          </Link>
        ))}
      </div>
      {products.length === 0 && (
        <p className="muted">
          <Link href="/products/new">Connect a product</Link> to run discovery.
        </p>
      )}
    </main>
  );
}
