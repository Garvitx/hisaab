import { connection } from "next/server";
import { db } from "@/lib/db";
import { PayQR } from "@/components/pay/PayQR";

// Server-only: looks up name and city and renders the pay agent's signed QR. The caller sets width via `className`.
export async function MerchantQR({ mid, className }: { mid: string; className?: string }) {
  await connection();
  const m = await db.merchant.findUnique({ where: { id: mid }, select: { business_name: true, city: true } });
  if (!m) return null;
  return (
    <div className={className}>
      <PayQR mid={mid} businessName={m.business_name} city={m.city} />
    </div>
  );
}
